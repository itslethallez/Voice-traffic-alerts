import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Camera, Cctv, Shield, type LucideIcon } from 'lucide-react-native';
import type { AlertType } from '../../../shared/alert-schema';
import { alpha, colors, radii, spacing, typography } from '../../theme/tokens';

/** The normalized alert categories from shared/alert-schema.ts. One
 * component drives all of them — never fork this into per-type components. */
export type AlertPillType = AlertType;

/**
 * Category → colour + optional glyph, matched to the mockups' alert-icon
 * coding: the police/camera family is informational coolBlue (a live
 * sighting gets the badge Shield, a published mobile-camera window the
 * handheld Camera, permanent infrastructure the mounted Cctv - distinct
 * glyphs, one colour family per the brand board), traffic and accidents
 * are the critical tier (red, reserved for the highest-severity types),
 * closures and hazards are caution (amber), roadkill rides the brand
 * teal. Only the police family carries an icon today - it's the family
 * that splits one colour three ways, so the glyph does the telling the
 * colour can't; the dot stays for everyone else.
 */
const PILL_META: Record<AlertPillType, { label: string; color: string; icon?: LucideIcon }> = {
  police: { label: 'Police', color: colors.coolBlue, icon: Shield },
  mobile_camera: { label: 'Mobile camera', color: colors.coolBlue, icon: Camera },
  fixed_camera: { label: 'Fixed camera', color: colors.coolBlue, icon: Cctv },
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
  const glyphColor = enabled ? meta.color : colors.textMuted;
  const Icon = meta.icon;
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
      {showDot ? (
        Icon ? (
          <Icon size={small ? 11 : 13} strokeWidth={2.2} color={glyphColor} />
        ) : (
          <View style={[styles.dot, { backgroundColor: glyphColor }]} />
        )
      ) : null}
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
