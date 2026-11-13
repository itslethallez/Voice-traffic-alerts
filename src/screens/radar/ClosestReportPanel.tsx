import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import type { ClosestAlert } from '../../engine/selectClosestOnPathAlert';
import { signedBearingOffset } from '../../geo/bearing';
import { ANNOUNCE_MAX_BEARING_DIFF_DEG } from '../../geo/announceWindow';
import { announcementLocation } from '../../speech/formatAnnouncement';
import type { NearbyReport } from '../../store/useTripStore';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { confidenceLabel } from '../../theme/confidence';
import { alpha, colors, radii, spacing, typography } from '../../theme/tokens';
import { GlassView } from '../../components/base/GlassView';
import { formatRelativeTime } from '../formatRelativeTime';
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

/** "5M AGO" — formatRelativeTime owns the unit ladder (s/m/h/d) so a
 * months-old fixed camera row can't print a six-digit minute count. */
function ageLabel(nowMs: number, publishedMs: number): string {
  return formatRelativeTime(publishedMs, nowMs).toUpperCase();
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
      <GlassView intensity={45} dim={0.5} style={styles.quietRoot} onLayout={onLayout}>
        <Text style={styles.quietHeader}>CLOSEST · {Math.round(bearingDiffDeg)}° OFF HEADING</Text>
        <Text style={styles.quietBody}>
          {meta.label.toUpperCase()}
          {place ? `, ${place.toUpperCase()}` : ''} — <Text style={styles.quietBodyMuted}>NOT ON YOUR PATH</Text>
        </Text>
      </GlassView>
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
    <GlassView intensity={45} dim={0.5} style={styles.root} onLayout={onLayout}>
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
            {ageLabel(nowMs, Date.parse(alert.publish_datetime_utc))}
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
    </GlassView>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopColor: colors.accent,
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  headerLabel: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.accent,
  },
  headerStatus: {
    marginLeft: 'auto',
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textMuted,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xxs,
  },
  typeBadge: {
    width: TYPE_BADGE_SIZE,
    height: TYPE_BADGE_SIZE,
    flexShrink: 0,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBadgeLetter: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.body,
    color: colors.textPrimary,
  },
  mainText: {
    flex: 1,
    minWidth: 0,
  },
  typeLabel: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.title,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  locationLine: {
    marginTop: spacing.xxs,
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: typography.fontSize.caption,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textSecondary,
  },
  distanceBlock: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xxs,
  },
  distanceValue: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.stat,
    letterSpacing: -1,
    lineHeight: 30,
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },
  distanceUnit: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.caption,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.accent,
  },
  closingTime: {
    marginTop: spacing.xxs,
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerCell: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: spacing.xxs,
  },
  footerLabel: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textMuted,
  },
  footerValue: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.caption,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  footerValueAccent: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.caption,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.accent,
  },
  confirmButton: {
    flexShrink: 0,
    width: 138,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: alpha(colors.coolBlue, 0.2),
  },
  confirmButtonDone: {
    borderColor: colors.border,
    backgroundColor: alpha(colors.coolBlue, 0.1),
    opacity: 0.7,
  },
  confirmCaption: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.navigation,
  },
  confirmLabel: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.caption,
    color: colors.textPrimary,
  },
  quietRoot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.screenPadding,
    paddingVertical: spacing.sm,
  },
  quietHeader: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textMuted,
  },
  quietBody: {
    marginTop: spacing.xxs,
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.caption,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textSecondary,
  },
  quietBodyMuted: {
    color: colors.textMuted,
  },
});
