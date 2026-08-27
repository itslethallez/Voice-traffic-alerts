import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { WazeAlert } from '../api/waze/types';
import type { AnnounceableAlert } from '../engine/types';
import { haversineDistance } from '../geo/distance';
import { announcementLocation } from '../speech/formatAnnouncement';
import { STALE_ANNOUNCEMENT_AGE_MINUTES } from '../speech/constants';
import { statusFor, statusLabel, useTripStore } from '../store/useTripStore';
import { manualReportToWazeAlert } from '../store/manualReportAlert';
import { enabledTypesFromSettings } from '../store/settingsDefaults';
import { useSettingsStore } from '../store/useSettingsStore';
import { alertTypeMeta } from '../theme/alertTypeMeta';
import { instrument } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { confidenceLabel } from '../theme/confidence';
import { PoliceLightBar } from './radar/PoliceLightBar';
import { RadarMap } from './radar/RadarMap';
import { ReportButton } from './radar/ReportButton';
import { splitCompactDistance } from './radar/formatCompactDistance';
import { Speedometer } from './radar/Speedometer';

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
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);
  const manualReports = useTripStore((state) => state.manualReports);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [focusedAlert, setFocusedAlert] = useState<WazeAlert | null>(null);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  // Two-zone layout rework: this feed now mirrors exactly what the map
  // plots (mapVisibleAlerts there, the same enabledTypes filter here) -
  // no cap, no forward-facing bearing cone. selectNearbyAlerts.ts (the old
  // top-3/90-degree-cone logic) is gone; "expiring" needs no extra
  // handling, since this simply re-derives from live visibleAlerts on
  // every poll, same as before.
  const nearbyAlerts = useMemo(() => {
    if (!driverPosition) return [];
    const waze = visibleAlerts.filter((alert) => enabledTypes.has(alert.type));
    // A submitted report is inherently a police report, same POLICE-toggle
    // gating as every other category filter here - previously manualReports
    // was never read on this screen at all, so a report had no visible
    // trace in the feed.
    const reports = enabledTypes.has('POLICE')
      ? manualReports
          .filter((report): report is typeof report & { position: NonNullable<typeof report.position> } =>
            Boolean(report.position)
          )
          .map(manualReportToWazeAlert)
      : [];
    return [...waze, ...reports]
      .map((alert) => ({ alert, distanceMeters: haversineDistance(driverPosition, alert) }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [visibleAlerts, manualReports, enabledTypes, driverPosition]);

  const status = statusFor({ masterMute, isOffline });
  const metaLine = `${statusLabel(status).toUpperCase()} · ${formatAwarenessKm(announceDistanceMeters)} KM AWARENESS · ${
    driverPosition ? 'GPS LOCKED' : 'ACQUIRING GPS'
  }`;

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
          {locationError ? (
            <Text style={styles.metaLine}>{locationError}</Text>
          ) : (
            <Text style={styles.metaLine}>{metaLine}</Text>
          )}
          {bannerMessage ? <Text style={styles.bannerLine}>{bannerMessage}</Text> : null}
        </View>

        <View style={styles.mapArea}>
          <RadarMap focusedAlert={focusedAlert} />
        </View>

        <View style={styles.ledger}>
          <View style={styles.ledgerHeaderRow}>
            <Text style={styles.ledgerHeaderLabel}>NEARBY ALERTS</Text>
            <Text style={styles.ledgerHeaderLabel}>{nearbyAlerts.length} ALERTS</Text>
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
                  inverted={index === 0}
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
  inverted,
  onPress,
}: {
  nearby: { alert: WazeAlert; distanceMeters: number };
  nowMs: number;
  inverted: boolean;
  onPress: () => void;
}) {
  const { alert, distanceMeters } = nearby;
  const meta = alertTypeMeta(alert.type, alert.subtype);
  const ageMinutes = ageMinutesOf(alert, nowMs);
  const isStale = ageMinutes > STALE_ANNOUNCEMENT_AGE_MINUTES;
  const place = locationFor(alert, ageMinutes);
  const detail = isStale ? `${Math.round(ageMinutes)} MIN AGO` : confidenceLabel(alert.alert_reliability).toUpperCase();
  const subtitle = place ? `${place.toUpperCase()} · ${detail}` : detail;
  const { value, unit } = splitCompactDistance(distanceMeters);

  return (
    <Pressable
      onPress={onPress}
      style={[styles.ledgerRow, inverted && styles.ledgerRowInverted]}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label} alert, ${value} ${unit} ahead, ${subtitle.toLowerCase()}`}
    >
      {inverted && alert.type === 'POLICE' ? (
        <PoliceLightBar orientation="vertical" width={26} height={26} inverted />
      ) : null}
      <View style={styles.ledgerRowText}>
        <Text style={[styles.ledgerRowTitle, inverted && styles.ledgerRowTextInverted]}>
          {meta.label.toUpperCase()}
        </Text>
        <Text
          style={[
            styles.ledgerRowSubtitle,
            inverted ? styles.ledgerRowSubtitleInverted : styles.ledgerRowSubtitleNormal,
          ]}
        >
          {subtitle}
        </Text>
      </View>
      <Text style={[styles.ledgerRowValue, inverted && styles.ledgerRowTextInverted]}>{value}</Text>
      <Text
        style={[
          styles.ledgerRowUnit,
          inverted ? styles.ledgerRowSubtitleInverted : styles.ledgerRowSubtitleNormal,
        ]}
      >
        {unit}
      </Text>
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
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: instrument.paper,
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
    backgroundColor: instrument.paper,
  },
  liveText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    letterSpacing: 1.5,
    color: instrument.paper,
  },
  metaLine: {
    marginTop: 6,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: 1.5,
    color: instrument.mutedOnInk,
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
    borderBottomWidth: 2,
    borderBottomColor: instrument.paper,
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
    color: instrument.mutedOnInk,
  },
  ledgerRule: {
    borderTopWidth: 2,
    borderTopColor: instrument.paper,
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: instrument.ruleOnInk,
  },
  ledgerRowInverted: {
    backgroundColor: instrument.paper,
  },
  ledgerRowText: {
    flex: 1,
    minWidth: 0,
  },
  ledgerRowTitle: {
    fontFamily: fontFamily.black,
    fontSize: 19,
    letterSpacing: 0.5,
    color: instrument.paper,
  },
  ledgerRowSubtitle: {
    marginTop: 1,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  ledgerRowSubtitleNormal: {
    color: instrument.mutedOnInk,
  },
  ledgerRowSubtitleInverted: {
    color: instrument.ink,
    opacity: 0.85,
  },
  ledgerRowTextInverted: {
    color: instrument.ink,
  },
  ledgerRowValue: {
    fontFamily: fontFamily.black,
    fontSize: 24,
    color: instrument.paper,
    fontVariant: ['tabular-nums'],
  },
  ledgerRowUnit: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1,
  },
  speedReportRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexGrow: 0,
    flexShrink: 0,
    borderTopWidth: 2,
    borderTopColor: instrument.paper,
  },
});
