import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Binoculars, Navigation } from 'lucide-react-native';
import { Column } from '../../components/base/Layout';
import { GlassView } from '../../components/base/GlassView';
import { alpha, colors, radii, spacing, typography } from '../../theme/tokens';

interface ModeSwitchProps {
  /** Opens the destination-search / trip-planning flow. The Navigate
   * segment is omitted entirely when the app can't offer navigation -
   * same rule as the old search button: never a dead control. */
  onNavigatePress?: () => void;
}

/**
 * The §8 "compact Cruising / Navigate switch" from the 3D design guide and
 * the mode-toggle in the Cruising/Navigate mockups: two equal pill
 * segments at the top of the map screen. Cruising is always the active
 * segment on DriveScreen; Navigate is the "Plan a trip" entry point.
 * Treatment is the guide's floating chrome - backdrop blur via GlassView,
 * soft border, teal focus state on the active segment.
 */
export function ModeSwitch({ onNavigatePress }: ModeSwitchProps) {
  return (
    <View style={styles.root}>
      <GlassView intensity={40} dim={0.4} style={[styles.segment, styles.segmentActive]}>
        <Binoculars size={20} strokeWidth={2} color={colors.accent} />
        <Column gap="xxs" flex={1}>
          <Text style={styles.segmentTitle}>CRUISING</Text>
          <Text style={styles.segmentSub}>Live road alerts around you</Text>
        </Column>
      </GlassView>
      {onNavigatePress ? (
        <Pressable
          onPress={onNavigatePress}
          style={styles.segmentHit}
          accessibilityRole="button"
          accessibilityLabel="Navigate - plan a trip"
          accessibilityHint="Opens destination search to start turn-by-turn navigation"
        >
          <GlassView intensity={40} dim={0.4} style={styles.segment}>
            <Navigation size={20} strokeWidth={2} color={colors.textSecondary} />
            <Column gap="xxs" flex={1}>
              <Text style={styles.segmentTitle}>NAVIGATE</Text>
              <Text style={styles.segmentSub}>Plan a trip</Text>
            </Column>
          </GlassView>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segmentHit: {
    flex: 1,
  },
  segment: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentActive: {
    // Teal veil over the blur instead of the default charcoal dim.
    backgroundColor: alpha(colors.teal, 0.18),
    borderColor: alpha(colors.teal, 0.55),
  },
  segmentTitle: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.body,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textPrimary,
  },
  segmentSub: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textSecondary,
  },
});
