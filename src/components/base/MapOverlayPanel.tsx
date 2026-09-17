import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../../theme/tokens';

export interface MapOverlayPanelProps {
  /** Which map edge the panel hugs. */
  edge: 'top' | 'bottom';
  /** Extra distance from the edge on top of the safe-area inset — e.g. a
   * collapsed BottomSheet's peek height, for a control strip that must
   * clear it. */
  offset?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Floating chrome that sits on top of the full-bleed map — top bar,
 * filter row, bottom control strip. Anchored to one screen edge, keeps the
 * safe-area inset on that edge, and applies the standard screen padding
 * horizontally. Children lay out in normal flow (compose Row/Column/Stack
 * inside; never position children absolutely).
 *
 * NOTE: uses absolute positioning to float over the map — this component
 * and BottomSheet are the sanctioned exceptions to the no-absolute rule,
 * since overlay-on-map chrome can't be expressed in normal flow.
 * `pointerEvents="box-none"` keeps the map pannable through the gaps
 * between children.
 */
export function MapOverlayPanel({ edge, offset = 0, style, children }: PropsWithChildren<MapOverlayPanelProps>) {
  const insets = useSafeAreaInsets();
  const inset = edge === 'top' ? insets.top : insets.bottom;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.panel, edge === 'top' ? { top: inset + offset } : { bottom: inset + offset }, style]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: spacing.screenPadding,
  },
});
