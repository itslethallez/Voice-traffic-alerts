import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { alpha, colors, radii, spacing, typography } from '../../theme/tokens';

/** The six alert categories from the brand board's "Key categories". One
 * component drives all of them — never fork this into per-type components. */
export type AlertPillType = 'police' | 'traffic' | 'accident' | 'closure' | 'roadkill' | 'hazard';

/**
 * Category → colour, matched to the mockups' alert-icon coding: police are
 * informational (coolBlue), traffic and accidents are the critical tier
 * (red, reserved for the highest-severity types), closures and hazards are
 * caution (amber), roadkill rides the brand teal.
 */
const PILL_META: Record<AlertPillType, { label: string; color: string }> = {
  police: { label: 'Police', color: colors.coolBlue },
  traffic: { label: 'Traffic', color: colors.red },
  accident: { label: 'Accident', color: colors.red },
  closure: { label: 'Closure', color: colors.amber },
  roadkill: { label: 'Roadkill', color: colors.teal },
  hazard: { label: 'Hazard', color: colors.amber },
};

export interface AlertPillProps {
  type: AlertPillType;
  /** Overrides the default per-type label (e.g. a police subtype). */
  label?: string;
  /** `sm` is the compact marker for dense lists; `md` (default) is the
   * standard pill used on cards and detail views. */
  size?: 'sm' | 'md';
  /** Hide the leading colour dot when the pill sits next to a category
   * icon that already carries the colour. */
  showDot?: boolean;
  /** `false` renders the disabled state: near-opaque dark surface with
   * muted dot/label. Never dim a selected pill with `opacity` — the tinted
   * background is only 14% alpha, so fading it further over a map reads as
   * invisible. The off state needs to be *more* opaque, not less. */
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The colour-coded category pill from the mockups — a tinted, rounded chip
 * with a colour dot and an uppercase label. All colour comes from
 * PILL_META keyed on `type`.
 */
export function AlertPill({ type, label, size = 'md', showDot = true, enabled = true, style }: AlertPillProps) {
  const meta = PILL_META[type];
  const small = size === 'sm';
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: enabled ? alpha(meta.color, 0.14) : alpha(colors.charcoal, 0.88),
          borderColor: enabled ? alpha(meta.color, 0.4) : colors.borderStrong,
          paddingHorizontal: small ? spacing.xs : spacing.sm,
          paddingVertical: small ? spacing.xxs : spacing.xs,
          gap: spacing.xs,
        },
        style,
      ]}
    >
      {showDot ? <View style={[styles.dot, { backgroundColor: enabled ? meta.color : colors.textMuted }]} /> : null}
      <Text
        style={[
          styles.label,
          {
            color: enabled ? meta.color : colors.textSecondary,
            fontSize: small ? typography.fontSize.eyebrow : typography.fontSize.caption,
          },
        ]}
      >
        {(label ?? meta.label).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
  },
  label: {
    fontFamily: typography.fontFamily.displayMedium,
    letterSpacing: typography.letterSpacing.eyebrow,
  },
});
