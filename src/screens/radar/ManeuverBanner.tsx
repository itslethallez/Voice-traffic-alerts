import type { LayoutChangeEvent } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../theme/tokens';
import { formatCompactDistance } from './formatCompactDistance';

interface ManeuverBannerProps {
  instruction: string;
  distanceMeters: number | null;
  /** Reports this banner's actually-rendered height, same pattern as
   * ClosestReportPanel's own onLayout - RadarMap.tsx uses it to keep the
   * zoom/recenter button column (mapControls) clear of a two-line
   * instruction instead of a fixed offset that a long instruction could
   * grow past. */
  onLayout?: (event: LayoutChangeEvent) => void;
}

/**
 * The map's top status chip while navigating - replaces the plain compass
 * heading chip RadarMap.tsx otherwise shows there. Same position as that
 * chip, but the same visual weight as the existing RANGE badge
 * (rangeLabelBadge) rather than the small always-on heading pill: a turn
 * instruction is the single most important thing on screen while
 * navigating and should read that way.
 */
export function ManeuverBanner({ instruction, distanceMeters, onLayout }: ManeuverBannerProps) {
  return (
    <View style={styles.root} pointerEvents="none" onLayout={onLayout}>
      {distanceMeters !== null ? (
        <Text style={styles.distance}>{formatCompactDistance(distanceMeters).toUpperCase()}</Text>
      ) : null}
      <Text style={styles.instruction} numberOfLines={2}>
        {instruction.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 78,
    left: spacing.md,
    right: spacing.md,
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
});
