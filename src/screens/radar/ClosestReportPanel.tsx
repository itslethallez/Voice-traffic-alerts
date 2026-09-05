import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import type { ClosestAlert } from '../../engine/selectClosestOnPathAlert';
import { signedBearingOffset } from '../../geo/bearing';
import { ANNOUNCE_MAX_BEARING_DIFF_DEG } from '../../geo/announceWindow';
import { announcementLocation } from '../../speech/formatAnnouncement';
import type { NearbyReport } from '../../store/useTripStore';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { confidenceLabel } from '../../theme/confidence';
import { hud } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';
import { formatClosingTime } from './formatClosingTime';
import { splitCompactDistance } from './formatCompactDistance';
import { PoliceLightBar } from './PoliceLightBar';

const LIGHT_BAR_WIDTH = 30;
const LIGHT_BAR_HEIGHT = 13;
const TYPE_BADGE_SIZE = 28;

/** "12° LEFT" / "AHEAD" - small offsets read as noise, not a meaningful
 * direction, so they're folded into "AHEAD" rather than "1° RIGHT". */
const NEGLIGIBLE_OFFSET_DEG = 3;

function offsetLabel(offsetDeg: number): string {
  const magnitude = Math.round(Math.abs(offsetDeg));
  if (magnitude < NEGLIGIBLE_OFFSET_DEG) return 'AHEAD';
  return `${magnitude}° ${offsetDeg < 0 ? 'LEFT' : 'RIGHT'}`;
}

function confidenceTierLabel(reliability: number): string {
  // confidenceLabel returns "High confidence" etc. - the panel's own
  // caps-only style wants just the tier word.
  return confidenceLabel(reliability).split(' ')[0].toUpperCase();
}

function ageLabel(ageMinutes: number): string {
  const rounded = Math.round(ageMinutes);
  if (rounded <= 0) return 'JUST NOW';
  return `${rounded} MIN AGO`;
}

export interface ClosestReportPanelProps {
  closest: ClosestAlert;
  driverHeadingDeg: number;
  driverSpeedKmh: number;
  nowMs: number;
  /** Set only when `closest` is another device's report (confirmable) -
   * mirrors RadarMap.tsx's AlertMarker's own nearbyReport prop. Undefined
   * for Waze's own alerts and this device's own reports, neither of which
   * can be confirmed. */
  nearbyReport?: NearbyReport;
  onConfirm?: (id: string) => void;
  /** Reports this panel's actually-rendered height back to RadarMap.tsx, so
   * it can pad the map Camera by that amount and lift the driver mark clear
   * of the panel (`6a`'s "sits at 34% of map height so it clears the focus
   * panel") - measured rather than hardcoded since the panel's height
   * differs between the on-path and stood-down states below. */
  onLayout?: (event: LayoutChangeEvent) => void;
}

/**
 * The bottom-of-map overlay for the single closest alert
 * (`Voice Traffic Alerts - Current UI.dc.html` turn 6, "Focus panel") -
 * replaces RadarMap.tsx's plain compass heading chip whenever a qualifying
 * alert exists. Two treatments depending on bearingDiffDeg, both built from
 * the exact same `closest` RadarMap.tsx and DriveScreen.tsx already agree on
 * (selectClosestOnPathAlert):
 *
 * - Within ANNOUNCE_MAX_BEARING_DIFF_DEG (genuinely ahead): the full panel -
 *   heading/bearing status, type + location + distance + closing time, and a
 *   footer strip with confidence, age, and (for a confirmable nearby report)
 *   a STILL THERE? button wired to the same confirmNearbyReport the map's
 *   marker chip already uses.
 * - Past it: a single quiet line - the alert exists and is close, but isn't
 *   worth the full treatment since the driver isn't headed toward it.
 */
export function ClosestReportPanel({
  closest,
  driverHeadingDeg,
  driverSpeedKmh,
  nowMs,
  nearbyReport,
  onConfirm,
  onLayout,
}: ClosestReportPanelProps) {
  const { alert, distanceMeters, bearingDeg, bearingDiffDeg } = closest;
  const meta = alertTypeMeta(alert.type, alert.subtype);
  const isPolice = alert.type === 'POLICE';
  const ageMinutes = (nowMs - Date.parse(alert.publish_datetime_utc)) / 60_000;
  const location = announcementLocation({
    alert,
    distanceMeters,
    bearingDeg,
    bearingDiffDeg,
    ageMinutes,
    driverHeadingDeg,
  });

  const isOnPath = bearingDiffDeg <= ANNOUNCE_MAX_BEARING_DIFF_DEG;

  if (!isOnPath) {
    const place = [location.street, location.area].filter((part): part is string => Boolean(part)).join(', ');
    return (
      <View style={styles.quietRoot} onLayout={onLayout}>
        <Text style={styles.quietHeader}>CLOSEST · {Math.round(bearingDiffDeg)}° OFF HEADING</Text>
        <Text style={styles.quietBody}>
          {meta.label.toUpperCase()}
          {place ? `, ${place.toUpperCase()}` : ''} — <Text style={styles.quietBodyMuted}>NOT ON YOUR PATH</Text>
        </Text>
      </View>
    );
  }

  const offset = signedBearingOffset(driverHeadingDeg, bearingDeg);
  const { value: distanceValue, unit: distanceUnit } = splitCompactDistance(distanceMeters);
  const closingTime = formatClosingTime(distanceMeters, driverSpeedKmh);
  const locationLine = [location.street, location.area, `${location.direction}bound`]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
    .toUpperCase();

  const canConfirm = nearbyReport !== undefined;
  const alreadyConfirmed = nearbyReport?.confirmedByThisDevice ?? false;

  return (
    <View style={styles.root} onLayout={onLayout}>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>CLOSEST · HEADING TOWARD</Text>
        <Text style={styles.headerStatus}>{offsetLabel(offset)} · CLOSING</Text>
      </View>

      <View style={styles.mainRow}>
        {isPolice ? (
          <PoliceLightBar orientation="horizontal" width={LIGHT_BAR_WIDTH} height={LIGHT_BAR_HEIGHT} />
        ) : (
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeLetter}>{meta.letter}</Text>
          </View>
        )}
        <View style={styles.mainText}>
          <Text style={styles.typeLabel}>{meta.label.toUpperCase()}</Text>
          <Text style={styles.locationLine} numberOfLines={1}>
            {locationLine}
          </Text>
        </View>
        <View style={styles.distanceBlock}>
          <View style={styles.distanceRow}>
            <Text style={styles.distanceValue}>{distanceValue}</Text>
            <Text style={styles.distanceUnit}>{distanceUnit}</Text>
          </View>
          {closingTime ? (
            <Text style={styles.closingTime}>
              {closingTime} AT {Math.round(driverSpeedKmh)} KM/H
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.footerRow}>
        <View style={styles.footerCell}>
          <Text style={styles.footerLabel}>CONFIDENCE</Text>
          <Text style={styles.footerValueAccent} numberOfLines={1}>
            {confidenceTierLabel(alert.alert_reliability)}
            {nearbyReport && nearbyReport.corroborationCount > 0 ? ` · ${nearbyReport.corroborationCount}×` : ''}
          </Text>
        </View>
        <View style={styles.footerCell}>
          <Text style={styles.footerLabel}>REPORTED</Text>
          <Text style={styles.footerValue} numberOfLines={1}>
            {ageLabel(ageMinutes)}
          </Text>
        </View>
        {canConfirm ? (
          <Pressable
            onPress={alreadyConfirmed || !onConfirm ? undefined : () => onConfirm(alert.alert_id)}
            style={[styles.confirmButton, alreadyConfirmed && styles.confirmButtonDone]}
            accessibilityRole={alreadyConfirmed ? undefined : 'button'}
            accessibilityLabel={alreadyConfirmed ? 'Confirmed still there' : "Confirm it's still there"}
          >
            <Text style={styles.confirmCaption}>{alreadyConfirmed ? 'CONFIRMED' : 'CONFIRM'}</Text>
            <Text style={styles.confirmLabel}>{alreadyConfirmed ? 'THANKS' : 'STILL THERE?'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(7,9,12,0.94)',
    borderTopWidth: 1,
    borderTopColor: hud.accent,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  headerLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    letterSpacing: 2,
    color: hud.accent,
  },
  headerStatus: {
    marginLeft: 'auto',
    fontFamily: fontFamily.bold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: hud.muted,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 5,
  },
  typeBadge: {
    width: TYPE_BADGE_SIZE,
    height: TYPE_BADGE_SIZE,
    flexShrink: 0,
    borderWidth: 2,
    borderColor: hud.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBadgeLetter: {
    fontFamily: fontFamily.black,
    fontSize: 15,
    color: hud.ink,
  },
  mainText: {
    flex: 1,
    minWidth: 0,
  },
  typeLabel: {
    fontFamily: fontFamily.black,
    fontSize: 20,
    lineHeight: 21,
    color: hud.rowTitle,
  },
  locationLine: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 11,
    letterSpacing: 0.5,
    color: hud.rowSubHigh,
  },
  distanceBlock: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  distanceValue: {
    fontFamily: fontFamily.black,
    fontSize: 30,
    letterSpacing: -1,
    lineHeight: 30,
    color: hud.sevHighText,
    fontVariant: ['tabular-nums'],
  },
  distanceUnit: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1,
    color: hud.sevHighText,
  },
  closingTime: {
    marginTop: 2,
    fontFamily: fontFamily.bold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: hud.muted,
    fontVariant: ['tabular-nums'],
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    marginTop: 7,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: hud.rule,
  },
  footerCell: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 2,
  },
  footerLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: hud.mutedLabel,
  },
  footerValue: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    letterSpacing: 0.5,
    color: hud.rowSubHigh,
    fontVariant: ['tabular-nums'],
  },
  footerValueAccent: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    letterSpacing: 0.5,
    color: hud.sevHighText,
  },
  confirmButton: {
    flexShrink: 0,
    width: 138,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: hud.ruleStrong,
    backgroundColor: '#14395C',
  },
  confirmButtonDone: {
    borderColor: hud.rule,
    backgroundColor: '#0A2338',
    opacity: 0.7,
  },
  confirmCaption: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: hud.accentBright,
  },
  confirmLabel: {
    fontFamily: fontFamily.black,
    fontSize: 12,
    color: hud.rowTitle,
  },
  quietRoot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(7,9,12,0.94)',
    borderTopWidth: 1,
    borderTopColor: hud.rule,
    paddingHorizontal: 20,
    paddingVertical: 9,
  },
  quietHeader: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    letterSpacing: 2,
    color: hud.mutedLabel,
  },
  quietBody: {
    marginTop: 5,
    fontFamily: fontFamily.bold,
    fontSize: 13,
    letterSpacing: 0.5,
    color: hud.muted,
  },
  quietBodyMuted: {
    color: hud.rowSubHigh,
  },
});
