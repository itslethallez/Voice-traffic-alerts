import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Binoculars, Navigation } from 'lucide-react-native';
import { Column } from '../../components/base/Layout';
import { alpha, colors, radii, spacing, typography } from '../../theme/tokens';

interface ModeSwitchProps {
  /** Opens the destination-search / trip-planning flow. The Navigate
   * segment is omitted entirely when the app can't offer navigation -
   * same rule as the old search button: never a dead control. */
  onNavigatePress?: () => void;
}

/**
 * The §8 "compact Cruising / Navigate switch" from the 3D design guide and
 * the mode-toggle in the Cruising/Navigate mockups: two equal segments at
 * the top of the map screen. Cruising is always the active segment on
 * DriveScreen; Navigate is the "Plan a trip" entry point. Treatment is the
 * guide's floating chrome - dark translucent surface, soft border, teal
 * focus state on the active segment.
 */
export function ModeSwitch({ onNavigatePress }: ModeSwitchProps) {
  return (
    <View style={styles.root}>
      <View style={[styles.segment, styles.segmentActive]}>
        <Binoculars size={22} strokeWidth={2} color={colors.accent} />
        <Column gap="xxs" flex={1}>
          <Text style={styles.segmentTitle}>CRUISING</Text>
          <Text style={styles.segmentSub}>Live road alerts around you</Text>
        </Column>
      </View>
      {onNavigatePress ? (
        <Pressable
          onPress={onNavigatePress}
          style={styles.segment}
          accessibilityRole="button"
          accessibilityLabel="Navigate - plan a trip"
          accessibilityHint="Opens destination search to start turn-by-turn navigation"
        >
          <Navigation size={22} strokeWidth={2} color={colors.textSecondary} />
          <Column gap="xxs" flex={1}>
            <Text style={styles.segmentTitle}>NAVIGATE</Text>
            <Text style={styles.segmentSub}>Plan a trip</Text>
          </Column>
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
  segment: {
    flex: 1,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: alpha(colors.charcoal, 0.82),
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentActive: {
    backgroundColor: alpha(colors.teal, 0.16),
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
