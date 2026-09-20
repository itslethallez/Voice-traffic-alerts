import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../theme/tokens';
import { formatCompactDistance } from './formatCompactDistance';

interface ManeuverBannerProps {
  instruction: string;
  distanceMeters: number | null;
  /** The maneuver AFTER the immediate next one, shown smaller and fainter
   * as a preview ("then turn left onto X") - the standard nav-app
   * two-step lookahead. Comes straight from the active route's step list,
   * no extra data plumbing. */
  nextInstruction?: string | null;
}

/**
 * The map's top status while navigating - §8's "large next-turn
 * instruction near top". Rendered by DriveScreen inside the top
 * MapOverlayPanel, taking the ModeSwitch/filter row's slot while
 * navigating so it's the dominant top element (and, being normal flow
 * layout, can't overlap the chrome the way the old absolute-positioned
 * version did). Same visual weight as the existing RANGE badge.
 */
export function ManeuverBanner({ instruction, distanceMeters, nextInstruction }: ManeuverBannerProps) {
  return (
    <View style={styles.root} pointerEvents="none">
      {distanceMeters !== null ? (
        <Text style={styles.distance}>{formatCompactDistance(distanceMeters).toUpperCase()}</Text>
      ) : null}
      <Text style={styles.instruction} numberOfLines={2}>
        {instruction.toUpperCase()}
      </Text>
      {nextInstruction ? (
        <Text style={styles.next} numberOfLines={1}>
          {`THEN ${nextInstruction.toUpperCase()}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navigation,
  },
  distance: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.title,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.navigation,
  },
  instruction: {
    marginTop: spacing.xxs,
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.caption,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textPrimary,
  },
  next: {
    marginTop: spacing.xs,
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textSecondary,
  },
});
