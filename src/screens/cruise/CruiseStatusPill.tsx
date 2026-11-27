import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Settings as SettingsIcon, Volume2, VolumeX } from 'lucide-react-native';
import { Column, Row } from '../../components/base/Layout';
import { colors, radii, shadows, sizes, spacing, typography } from '../../theme/tokens';

/** How fresh the alert feed is - drives the dot and the subline. */
export type FeedState = 'live' | 'stale' | 'offline';

export interface CruiseStatusPillProps {
  feedState: FeedState;
  /** "Watching 4 km around you" - the driver's alert radius. */
  watchingKm: number;
  /** Shown for 'stale' ("Last update 6 min ago"). */
  lastUpdateLabel: string | null;
  muted: boolean;
  onToggleMute: () => void;
  /** Omitted = no settings button (never a dead one). */
  onOpenSettings?: () => void;
}

const DOT_COLOR: Record<FeedState, string> = {
  live: colors.accent,
  stale: colors.caution,
  offline: colors.critical,
};

/**
 * Stage 8 Cruise header (mockup board 1): one status pill plus round
 * chrome buttons. Degraded confidence is never silent - CLAUDE.md: a stale
 * or offline feed changes the dot colour AND says so in words, so a quiet
 * map can't read as "all clear".
 *
 * The mockup shows mute only; settings keeps its own round button here
 * because the old header gear was its only entry point.
 */
export function CruiseStatusPill({
  feedState,
  watchingKm,
  lastUpdateLabel,
  muted,
  onToggleMute,
  onOpenSettings,
}: CruiseStatusPillProps) {
  const subline =
    feedState === 'offline'
      ? 'Offline - alerts may be out of date'
      : feedState === 'stale'
        ? `Alerts not updating · ${lastUpdateLabel ?? 'a while ago'}`
        : `Watching ${formatKm(watchingKm)} around you`;
  const title = muted ? 'Cruising · voice off' : 'Cruising';

  return (
    <Row gap="compact" align="center">
      <View
        style={styles.pill}
        accessible
        accessibilityRole="summary"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${title}. ${subline}`}
      >
        <View style={[styles.dot, { backgroundColor: DOT_COLOR[feedState] }]} />
        <Column flex={1}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text
            style={[styles.subline, feedState !== 'live' && { color: DOT_COLOR[feedState] }]}
            numberOfLines={1}
          >
            {subline}
          </Text>
        </Column>
      </View>
      <Pressable
        onPress={onToggleMute}
        style={styles.roundButton}
        accessibilityRole="button"
        accessibilityState={{ selected: muted }}
        accessibilityLabel={muted ? 'Turn voice alerts back on' : 'Mute voice alerts'}
      >
        {muted ? (
          <VolumeX size={22} strokeWidth={2} color={colors.caution} />
        ) : (
          <Volume2 size={22} strokeWidth={2} color={colors.textPrimary} />
        )}
      </Pressable>
      {onOpenSettings ? (
        <Pressable
          onPress={onOpenSettings}
          style={styles.roundButton}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
        >
          <SettingsIcon size={22} strokeWidth={2} color={colors.textPrimary} />
        </Pressable>
      ) : null}
    </Row>
  );
}

function formatKm(km: number): string {
  return km >= 10 || Number.isInteger(km) ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}

const styles = StyleSheet.create({
  pill: {
    flex: 1,
    height: sizes.chrome,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.roomy,
    ...shadows.chrome,
  },
  dot: {
    width: sizes.statusDot,
    height: sizes.statusDot,
    borderRadius: radii.pill,
  },
  title: {
    fontFamily: typography.fontFamily.bodyBold,
    fontSize: typography.fontSize.body,
    color: colors.textPrimary,
  },
  subline: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textSecondary,
  },
  roundButton: {
    width: sizes.chrome,
    height: sizes.chrome,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.chrome,
  },
});
