import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { WazeAlert } from '../api/waze/types';
import { selectClosestOnPathAlert } from '../engine/selectClosestOnPathAlert';
import type { AnnounceableAlert } from '../engine/types';
import { haversineDistance } from '../geo/distance';
import { announcementLocation } from '../speech/formatAnnouncement';
import { STALE_ANNOUNCEMENT_AGE_MINUTES } from '../speech/constants';
import { statusFor, statusLabel, useTripStore } from '../store/useTripStore';
import { visibleManualReportAlerts } from '../store/manualReportAlert';
import { visibleNearbyReportAlerts } from '../store/nearbyReportAlert';
import { enabledTypesFromSettings } from '../store/settingsDefaults';
import { useSettingsStore } from '../store/useSettingsStore';
import { alertTypeMeta } from '../theme/alertTypeMeta';
import { hud, instrument } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { confidenceLabel } from '../theme/confidence';
import { PoliceLightBar } from './radar/PoliceLightBar';
import { RadarMap } from './radar/RadarMap';
import { ReportButton } from './radar/ReportButton';
import { splitCompactDistance } from './radar/formatCompactDistance';
import { Speedometer } from './radar/Speedometer';

/** Row severity is a simple two-tier system for this colour pass, not a
 * per-category scale: the nearest row, or any POLICE row, is "high" -
 * everything else is "medium," regardless of its actual alert type. */
function isHighSeverity(alert: WazeAlert, index: number): boolean {
  return index === 0 || alert.type === 'POLICE';
}

const HIGH_ROW_GRADIENT = {
  colors: ['rgba(224,27,36,0.20)', 'rgba(224,27,36,0.03)', 'rgba(224,27,36,0)'] as const,
  locations: [0, 0.62, 1] as const,
};
const MEDIUM_ROW_GRADIENT = {
  colors: ['rgba(232,147,12,0.12)', 'rgba(232,147,12,0.02)', 'rgba(232,147,12,0)'] as const,
  locations: [0, 0.58, 1] as const,
};

/** How long a tapped ledger row keeps the map focused on it before the
 * camera returns to following the driver (Step 12 #25). */
const ALERT_FOCUS_DURATION_MS = 5000;

/** "5 KM AWARENESS" for a round number of km, "0.5 KM AWARENESS" otherwise -
 * the header meta line's own compact style, distinct from
 * formatCompactDistance's always-one-decimal-under-10km rule. */
function formatAwarenessKm(meters: number): string {
  const km = meters / 1000;
  return Number.isInteger(km) ? String(km) : km.toFixed(1);
}

/** Builds just enough of an AnnounceableAlert to reuse
 * speech/formatAnnouncement.ts's announcementLocation() for its street/area
 * resolution (including the suburb-preferring resolveAreaName and
 * route-number filtering) without re-deriving that logic here - direction
 * isn't needed for the ledger, so driverHeadingDeg/bearingDeg are unused
 * placeholders. */
function locationFor(alert: WazeAlert, ageMinutes: number) {
  const candidate: AnnounceableAlert = {
    alert,
    distanceMeters: 0,
    bearingDeg: 0,
    bearingDiffDeg: 0,
    ageMinutes,
    driverHeadingDeg: 0,
  };
  const location = announcementLocation(candidate);
  return location.street ?? location.area;
}

function ageMinutesOf(alert: WazeAlert, nowMs: number): number {
  return (nowMs - Date.parse(alert.publish_datetime_utc)) / 60_000;
}

export function DriveScreen() {
  const masterMute = useSettingsStore((state) => state.masterMute);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);
  const categoriesEnabled = useSettingsStore((state) => state.categoriesEnabled);

  const isOffline = useTripStore((state) => state.isOffline);
  const bannerMessage = useTripStore((state) => state.bannerMessage);
  const locationError = useTripStore((state) => state.locationError);
  const driverPosition = useTripStore((state) => state.driverPosition);
  const driverHeadingDeg = useTripStore((state) => state.driverHeadingDeg);
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);
  const manualReports = useTripStore((state) => state.manualReports);
  const nearbyReports = useTripStore((state) => state.nearbyReports);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [focusedAlert, setFocusedAlert] = useState<WazeAlert | null>(null);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // RadarMap's own auto-locate spotlight is private state there - this
  // mirrors just its active/inactive flag so `closest` below can suppress
  // itself for exactly as long as RadarMap suppresses its own focus panel,
  // not only while a tapped ledger row (focusedAlert) is set.
  const [spotlightActive, setSpotlightActive] = useState(false);

  const handleFocusAlert = useCallback((alert: WazeAlert) => {
    if (focusTimeoutRef.current !== null) {
      clearTimeout(focusTimeoutRef.current);
    }
    setFocusedAlert(alert);
    focusTimeoutRef.current = setTimeout(() => {
      setFocusedAlert(null);
      focusTimeoutRef.current = null;
    }, ALERT_FOCUS_DURATION_MS);
  }, []);

  useEffect(
    () => () => {
      if (focusTimeoutRef.current !== null) clearTimeout(focusTimeoutRef.current);
    },
    []
  );

  // Same enabled-categories state that already drives speech filtering and
  // the map's own markers (RadarMap.tsx) - reused here, not reimplemented,
  // so a category switched off in Settings disappears from this feed the
  // same instant it stops being announced/shown on the map.
  const enabledTypes = useMemo(() => enabledTypesFromSettings(categoriesEnabled), [categoriesEnabled]);
  // Two-zone layout rework: mirrors exactly what the map plots
  // (mapVisibleAlerts there, the same enabledTypes filter here) - no cap,
  // no forward-facing bearing cone. selectNearbyAlerts.ts (the old
  // top-3/90-degree-cone logic) is gone; "expiring" needs no extra
  // handling, since this simply re-derives from live visibleAlerts on
  // every poll, same as before. Unsorted and un-excluded (see `closest` and
  // `nearbyAlerts` below) - this is the shared base both derive from.
  const rawAlerts = useMemo(() => {
    if (!driverPosition) return [];
    const waze = visibleAlerts.filter((alert) => enabledTypes.has(alert.type));
    // Each report's own category gates it now, not a blanket POLICE check -
    // a report can be ACCIDENT/HAZARD since the category picker (Report
    // button) shipped, so gating all of them on the POLICE toggle would hide
    // a driver's own accident/hazard reports when POLICE is off, and never
    // hide them when ACCIDENT/HAZARD themselves are off.
    const ownReports = visibleManualReportAlerts(manualReports, driverPosition, now, announceDistanceMeters).filter(
      (alert) => enabledTypes.has(alert.type)
    );
    const nearby = visibleNearbyReportAlerts(nearbyReports, driverPosition, now, announceDistanceMeters).filter(
      (alert) => enabledTypes.has(alert.type)
    );
    return [...waze, ...ownReports, ...nearby];
  }, [visibleAlerts, manualReports, nearbyReports, enabledTypes, driverPosition, now, announceDistanceMeters]);

  /**
   * The same "closest" alert RadarMap.tsx's focus panel shows
   * (`Voice Traffic Alerts - Current UI.dc.html` turn 6) - computed here
   * from the identical rawAlerts set (mirrors RadarMap.tsx's
   * mapVisibleAlerts) so both agree on exactly which alert that is, without
   * one having to pass it to the other as a prop. Suppressed while
   * focusedAlert (a tapped ledger row) or spotlightActive (RadarMap's own
   * auto-locate spotlight, mirrored back here via onSpotlightChange) is
   * set, matching RadarMap.tsx's own displayFocus gating exactly - whenever
   * the map is showing a row's or a new alert's own label instead of the
   * focus panel, nothing should be excluded from this ledger on that
   * alert's account either.
   */
  const closest = useMemo(() => {
    if (!driverPosition || focusedAlert || spotlightActive) return null;
    return selectClosestOnPathAlert(rawAlerts, driverPosition, driverHeadingDeg, announceDistanceMeters);
  }, [rawAlerts, driverPosition, focusedAlert, spotlightActive, driverHeadingDeg, announceDistanceMeters]);

  // Sorted, distance-tagged, and - the one thing rawAlerts doesn't already
  // do - excludes `closest` when it's set, since that alert has its own
  // focus panel on the map now and "ALSO AHEAD" below should list
  // everything else instead of repeating it.
  const nearbyAlerts = useMemo(() => {
    if (!driverPosition) return [];
    return rawAlerts
      .filter((alert) => alert.alert_id !== closest?.alert.alert_id)
      .map((alert) => ({ alert, distanceMeters: haversineDistance(driverPosition, alert) }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [rawAlerts, closest, driverPosition]);

  const status = statusFor({ masterMute, isOffline });
  const gpsClause = driverPosition ? 'GPS LOCKED' : 'ACQUIRING GPS';

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.brand}>SHOTGUN</Text>
            <View style={styles.headerSpacer} />
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
          <Text style={styles.motto}>EVERYTHING IS IN SIGHT</Text>
          {locationError ? (
            <Text style={styles.metaLine}>{locationError}</Text>
          ) : (
            <Text style={styles.metaLine}>
              {statusLabel(status).toUpperCase()} ·{' '}
              <Text style={styles.metaLineAccent}>{formatAwarenessKm(announceDistanceMeters)} KM</Text> AWARENESS ·{' '}
              <Text style={styles.metaLineAccent}>{gpsClause}</Text>
            </Text>
          )}
          {bannerMessage ? <Text style={styles.bannerLine}>{bannerMessage}</Text> : null}
        </View>

        <View style={styles.mapArea}>
          <RadarMap focusedAlert={focusedAlert} now={now} onSpotlightChange={setSpotlightActive} />
        </View>

        <View style={styles.ledger}>
          <View style={styles.ledgerHeaderRow}>
            {/* closest !== null means the map's focus panel is showing that
             * one alert on its own (RadarMap.tsx) - "ALSO AHEAD"/"N MORE"
             * makes clear this list is everything besides it, not the
             * driver's whole nearby picture. */}
            <Text style={styles.ledgerHeaderLabel}>{closest ? 'ALSO AHEAD' : 'NEARBY ALERTS'}</Text>
            <Text style={styles.ledgerHeaderCount}>{nearbyAlerts.length} {closest ? 'MORE' : 'ALERTS'}</Text>
          </View>
          {/* Persistent, uncapped feed (two-zone layout rework) - can run
           * long in a dense area, so this scrolls instead of the fixed
           * top-3 list it replaced. */}
          <ScrollView style={styles.ledgerScroll}>
            <View style={styles.ledgerRule}>
              {nearbyAlerts.map((nearby, index) => (
                <AlertLedgerRow
                  key={nearby.alert.alert_id}
                  nearby={nearby}
                  nowMs={now}
                  index={index}
                  onPress={() => handleFocusAlert(nearby.alert)}
                />
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={styles.speedReportRow}>
          <Speedometer />
          <ReportButton />
        </View>
      </SafeAreaView>
    </View>
  );
}

function AlertLedgerRow({
  nearby,
  nowMs,
  index,
  onPress,
}: {
  nearby: { alert: WazeAlert; distanceMeters: number };
  nowMs: number;
  index: number;
  onPress: () => void;
}) {
  const { alert, distanceMeters } = nearby;
  const isHigh = isHighSeverity(alert, index);
  const meta = alertTypeMeta(alert.type, alert.subtype);
  const ageMinutes = ageMinutesOf(alert, nowMs);
  const isStale = ageMinutes > STALE_ANNOUNCEMENT_AGE_MINUTES;
  const place = locationFor(alert, ageMinutes);
  const detail = isStale ? `${Math.round(ageMinutes)} MIN AGO` : confidenceLabel(alert.alert_reliability).toUpperCase();
  const subtitle = place ? `${place.toUpperCase()} · ${detail}` : detail;
  const { value, unit } = splitCompactDistance(distanceMeters);
  const gradient = isHigh ? HIGH_ROW_GRADIENT : MEDIUM_ROW_GRADIENT;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.ledgerRow, isHigh ? styles.ledgerRowHigh : styles.ledgerRowMedium]}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label} alert, ${value} ${unit} ahead, ${subtitle.toLowerCase()}`}
    >
      <LinearGradient
        colors={gradient.colors}
        locations={gradient.locations}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      {alert.type === 'POLICE' ? (
        <PoliceLightBar orientation="horizontal" width={30} height={13} />
      ) : null}
      <View style={styles.ledgerRowText}>
        <Text style={styles.ledgerRowTitle} numberOfLines={1}>
          {meta.label.toUpperCase()}
        </Text>
        <Text
          style={[styles.ledgerRowSubtitle, isHigh ? styles.ledgerRowSubtitleHigh : styles.ledgerRowSubtitleMedium]}
          numberOfLines={1}
        >
          {place ? `${place.toUpperCase()} · ` : ''}
          <Text style={isHigh ? styles.ledgerRowDetailHigh : styles.ledgerRowDetailMedium}>{detail}</Text>
        </Text>
      </View>
      <View style={styles.ledgerRowValueBlock}>
        <Text style={[styles.ledgerRowValue, isHigh ? styles.ledgerRowSevHighText : styles.ledgerRowSevMedText]}>
          {value}
        </Text>
        <Text style={[styles.ledgerRowUnit, isHigh ? styles.ledgerRowSevHighText : styles.ledgerRowSevMedText]}>
          {unit}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: instrument.ink,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexGrow: 0,
    flexShrink: 0,
    paddingTop: 6,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: hud.rule,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brand: {
    fontFamily: fontFamily.black,
    fontSize: 22,
    letterSpacing: 3,
    color: instrument.paper,
  },
  headerSpacer: {
    flex: 1,
  },
  liveDot: {
    width: 9,
    height: 9,
    backgroundColor: hud.accent,
  },
  liveText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    letterSpacing: 1.5,
    color: hud.accentInk,
  },
  motto: {
    marginTop: 5,
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 2.5,
    color: hud.sevMed,
  },
  metaLine: {
    marginTop: 8,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: 1.5,
    color: hud.muted,
  },
  metaLineAccent: {
    color: hud.accent,
  },
  bannerLine: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: 1.5,
    color: instrument.paper,
  },
  mapArea: {
    height: 268,
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: hud.rule,
    backgroundColor: instrument.mapGround,
  },
  ledger: {
    flex: 1,
    overflow: 'hidden',
  },
  ledgerScroll: {
    flex: 1,
  },
  ledgerHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  ledgerHeaderLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 2,
    color: hud.mutedLabel,
  },
  ledgerHeaderCount: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 2,
    color: hud.accent,
  },
  ledgerRule: {
    borderTopWidth: 1,
    borderTopColor: hud.rule,
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 20,
    paddingRight: 14,
    paddingVertical: 12,
    borderLeftWidth: 6,
    borderBottomWidth: 1,
    borderBottomColor: hud.rowRule,
  },
  ledgerRowHigh: {
    borderLeftColor: hud.sevHigh,
  },
  ledgerRowMedium: {
    borderLeftColor: hud.sevMed,
  },
  ledgerRowText: {
    flex: 1,
    minWidth: 0,
  },
  ledgerRowTitle: {
    fontFamily: fontFamily.black,
    fontSize: 17,
    letterSpacing: 0,
    color: hud.rowTitle,
  },
  ledgerRowSubtitle: {
    marginTop: 1,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: 0,
  },
  ledgerRowSubtitleHigh: {
    color: hud.rowSubHigh,
  },
  ledgerRowSubtitleMedium: {
    color: hud.rowSubMed,
  },
  ledgerRowDetailHigh: {
    color: hud.sevHighText,
  },
  ledgerRowDetailMedium: {
    color: hud.sevMed,
  },
  ledgerRowValueBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
    gap: 4,
    flexShrink: 0,
    minWidth: 44,
  },
  ledgerRowValue: {
    fontFamily: fontFamily.black,
    fontSize: 24,
    fontVariant: ['tabular-nums'],
  },
  ledgerRowUnit: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1,
  },
  ledgerRowSevHighText: {
    color: hud.sevHighText,
  },
  ledgerRowSevMedText: {
    color: hud.sevMed,
  },
  speedReportRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexGrow: 0,
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: hud.rule,
  },
});
