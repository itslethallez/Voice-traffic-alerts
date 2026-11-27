import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Volume2 } from 'lucide-react-native';
import type { WazeAlert } from '../../api/waze/types';
import { Column, Row, Stack } from '../../components/base/Layout';
import type { AlertFilterCategory } from '../../store/settingsDefaults';
import { colors, radii, shadows, sizes, spacing, typography } from '../../theme/tokens';
import { alertSourceLabel, alertVisual } from './alertVisual';

export interface LiveAlertCardProps {
  alert: WazeAlert;
  category: AlertFilterCategory;
  /** The sentence the voice just said - shown as the card's quote. */
  spokenText: string;
  /** "Main North Rd · 2 min ago" (place + age; omitted parts dropped). */
  detail: string;
  /** Live distance from the driver now; null before a fix. */
  distanceMeters: number | null;
  /** Distance when it was announced - the progress bar's 0%. */
  announcedDistanceMeters: number;
  /** Only a report from another Shotgun driver can be confirmed. */
  canConfirm: boolean;
  confirmed: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  onShowOnMap: () => void;
}

/**
 * Stage 8 live alert card (mockup board 2): the one big, glanceable card
 * that appears when Shotgun speaks. Replaces the old scrolling "LIVE
 * REPORT" ticker - a moving marquee is the opposite of glanceable.
 *
 * Mockup deviation, on purpose: its "Still there / Not there" pair is
 * shown only for reports from other Shotgun drivers, the one thing the
 * backend can confirm (there is no "not there" API yet). Everything else
 * gets Dismiss, never a button that does nothing.
 */
export function LiveAlertCard({
  alert,
  category,
  spokenText,
  detail,
  distanceMeters,
  announcedDistanceMeters,
  canConfirm,
  confirmed,
  onConfirm,
  onDismiss,
  onShowOnMap,
}: LiveAlertCardProps) {
  const visual = alertVisual(category);
  const distance = distanceMeters !== null ? splitDistance(distanceMeters) : null;
  const progress =
    distanceMeters !== null && announcedDistanceMeters > 0
      ? Math.min(1, Math.max(0, 1 - distanceMeters / announcedDistanceMeters))
      : 0;

  return (
    <View style={[styles.card, { borderColor: visual.color }]}>
      <Stack gap="md">
        <Pressable
          onPress={onShowOnMap}
          accessibilityRole="button"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={`${visual.headline}. ${detail}${distance ? `. ${distance.value} ${distance.unit}` : ''}. Show on map.`}
        >
          <Row gap="cozy" align="center">
            <View style={[styles.tile, { backgroundColor: visual.color }]}>
              <visual.Icon size={28} strokeWidth={2.2} color={visual.onColor} />
            </View>
            <Column flex={1} gap="xxs">
              <Text style={styles.headline}>{visual.headline}</Text>
              <Text style={styles.detail} numberOfLines={1}>
                {detail}
              </Text>
            </Column>
          </Row>
        </Pressable>

        {distance ? (
          <Row gap="xs" align="baseline">
            <Text style={styles.distanceValue}>{distance.value}</Text>
            <Text style={styles.distanceUnit}>{distance.unit}</Text>
          </Row>
        ) : null}
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(progress * 100)}%`, backgroundColor: visual.color }]} />
        </View>

        <Row gap="compact" align="center" style={styles.quote}>
          <Volume2 size={18} strokeWidth={2.2} color={colors.accent} />
          <Text style={styles.quoteText}>{`"${spokenText}"`}</Text>
        </Row>

        <Row gap="xs" align="center">
          <Text style={styles.sourceChip}>{alertSourceLabel(alert, category)}</Text>
        </Row>

        <Row gap="compact">
          {canConfirm ? (
            <Pressable
              onPress={onConfirm}
              disabled={confirmed}
              style={[styles.button, styles.buttonPrimary, confirmed && styles.buttonDone]}
              accessibilityRole="button"
              accessibilityState={{ disabled: confirmed }}
              accessibilityLabel={confirmed ? 'Confirmed still there' : "Confirm it's still there"}
            >
              <Text style={[styles.buttonLabel, styles.buttonLabelPrimary]}>{confirmed ? 'Thanks' : 'Still there'}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onDismiss}
            style={[styles.button, styles.buttonSecondary]}
            accessibilityRole="button"
            accessibilityLabel="Dismiss this alert card"
          >
            <Text style={styles.buttonLabel}>Dismiss</Text>
          </Pressable>
        </Row>
      </Stack>
    </View>
  );
}

/** 600 → "600 metres"; 1430 → "1.4 km" - the card's big number + unit. */
export function splitDistance(meters: number): { value: string; unit: string } {
  if (meters < 1000) return { value: String(Math.max(0, Math.round(meters / 10) * 10)), unit: 'metres' };
  return { value: (meters / 1000).toFixed(meters < 10_000 ? 1 : 0), unit: 'km' };
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.sheet,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 2,
    padding: spacing.roomy,
    ...shadows.card,
  },
  tile: {
    width: sizes.tileLg,
    height: sizes.tileLg,
    borderRadius: radii.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    fontFamily: typography.fontFamily.heavy,
    fontSize: typography.fontSize.cardTitle,
    lineHeight: typography.fontSize.cardTitle + spacing.xxs,
    color: colors.textPrimary,
  },
  detail: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.label,
    color: colors.textTertiary,
  },
  distanceValue: {
    fontFamily: typography.fontFamily.heavy,
    fontSize: typography.fontSize.hero,
    lineHeight: typography.fontSize.hero + spacing.xxs,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  distanceUnit: {
    fontFamily: typography.fontFamily.bodyBold,
    fontSize: typography.fontSize.sheetTitle,
    color: colors.textTertiary,
  },
  track: {
    height: sizes.progressTrack,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceTrack,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
  quote: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.cozy,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceInset,
  },
  quoteText: {
    flex: 1,
    fontFamily: typography.fontFamily.body,
    fontStyle: 'italic',
    fontSize: typography.fontSize.label,
    color: colors.textQuote,
  },
  sourceChip: {
    overflow: 'hidden',
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.compact,
    borderRadius: radii.chip,
    backgroundColor: colors.surfaceInset,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textSecondary,
  },
  button: {
    flex: 1,
    height: sizes.button,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonDone: {
    opacity: 0.6,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceTrack,
  },
  buttonLabel: {
    fontFamily: typography.fontFamily.bodyBold,
    fontSize: typography.fontSize.body,
    color: colors.textPrimary,
  },
  buttonLabelPrimary: {
    fontFamily: typography.fontFamily.heavy,
    color: colors.onAccent,
  },
});
