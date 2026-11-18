import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme/tokens';

export interface ScreenContainerProps {
  /** Which edges get safe-area padding. Default: top + sides. Bottom is
   * excluded because most screens end in a bottom nav or sheet that manages
   * its own inset — pass `bottom` explicitly when a screen needs it. */
  edges?: readonly Edge[];
  /** Set false for edge-to-edge content (e.g. a full-bleed map) — safe-area
   * insets still apply, only the tokenised outer padding is removed. */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The required outer wrapper for every screen: applies the charcoal app
 * ground, safe-area insets, and the consistent `spacing.screenPadding`
 * outer padding. No screen sets its own background or outer padding.
 */
export function ScreenContainer({
  edges = ['top', 'left', 'right'],
  padded = true,
  style,
  children,
}: PropsWithChildren<ScreenContainerProps>) {
  const insets = useSafeAreaInsets();
  const pad = padded ? spacing.screenPadding : 0;

  const has = (edge: Edge) => edges.includes(edge);

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: (has('top') ? insets.top : 0) + pad,
          paddingBottom: (has('bottom') ? insets.bottom : 0) + pad,
          paddingLeft: Math.max(has('left') ? insets.left : 0, pad),
          paddingRight: Math.max(has('right') ? insets.right : 0, pad),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
