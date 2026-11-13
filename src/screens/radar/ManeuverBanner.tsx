import { StyleSheet, Text, View } from 'react-native';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Merge,
  RotateCw,
  Undo2,
  type LucideIcon,
} from 'lucide-react-native';
import { alpha, colors, radii, spacing, typography } from '../../theme/tokens';
import { formatCompactDistance } from './formatCompactDistance';

interface ManeuverBannerProps {
  instruction: string;
  distanceMeters: number | null;
  /** The maneuver AFTER the immediate next one, shown smaller and fainter
   * as a preview ("then turn left onto X") - the standard nav-app
   * two-step lookahead. Comes straight from the active route's step list,
   * no extra data plumbing. */
  nextInstruction?: string | null;
  /** Mapbox maneuver type + modifier for the next maneuver, used to pick
   * the directional arrow glyph ("turn right" -> CornerUpRight). */
  maneuverType?: string;
  maneuverModifier?: string;
}

function maneuverIcon(type?: string, modifier?: string): LucideIcon {
  if (type === 'arrive') return Flag;
  if (type?.includes('roundabout') || type?.includes('rotary')) return RotateCw;
  if (modifier === 'uturn') return Undo2;
  if (type === 'merge') return Merge;
  switch (modifier) {
    case 'sharp right': return ArrowRight;
    case 'right': return CornerUpRight;
    case 'slight right': return ArrowUpRight;
    case 'sharp left': return ArrowLeft;
    case 'left': return CornerUpLeft;
    case 'slight left': return ArrowUpLeft;
    default: return ArrowUp;
  }
}

/**
 * The map's top status while navigating - §8's "large next-turn
 * instruction near top". Rendered by DriveScreen inside the top
 * MapOverlayPanel, taking the ModeSwitch/filter row's slot while
 * navigating so it's the dominant top element (and, being normal flow
 * layout, can't overlap the chrome the way the old absolute-positioned
 * version did). §7's treatment: a large directional arrow beside an
 * oversized distance, inside an accent-glow border.
 */
export function ManeuverBanner({ instruction, distanceMeters, nextInstruction, maneuverType, maneuverModifier }: ManeuverBannerProps) {
  const Icon = maneuverIcon(maneuverType, maneuverModifier);
  return (
    <View style={styles.root} pointerEvents="none">
      <Icon size={44} strokeWidth={2.6} color={colors.accent} style={styles.arrow} />
      <View style={styles.copy}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: alpha(colors.surface, 0.92),
    borderWidth: 1.5,
    borderColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 14,
    shadowOpacity: 0.55,
  },
  arrow: {
    flexShrink: 0,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  distance: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.stat,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.accent,
  },
  instruction: {
    marginTop: spacing.xxs,
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.bodyLarge,
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
