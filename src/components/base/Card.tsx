import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing, type SpacingKey } from '../../theme/tokens';

export interface CardProps {
  /** `raised` lifts the card onto `surfaceRaised` — for content that sits
   * on top of another surface (e.g. a sheet inside a sheet). `outlined`
   * keeps the asphalt ground but adds the slate hairline border. */
  variant?: 'flat' | 'raised' | 'outlined';
  /** Inner padding — a spacing step, defaults to `md`. */
  padding?: SpacingKey;
  style?: StyleProp<ViewStyle>;
}

/**
 * The dark surface card used for alert details, nearby-alerts panels, and
 * any grouped content block. Matches the mockups' asphalt surface with a
 * 16px radius — screens never restyle this, they compose it.
 */
export function Card({ variant = 'flat', padding = 'md', style, children }: PropsWithChildren<CardProps>) {
  return (
    <View
      style={[
        styles.base,
        variant === 'raised' && styles.raised,
        variant === 'outlined' && styles.outlined,
        { padding: spacing[padding] },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
  },
  raised: {
    backgroundColor: colors.surfaceRaised,
  },
  outlined: {
    borderWidth: 1,
    borderColor: colors.border,
  },
});
