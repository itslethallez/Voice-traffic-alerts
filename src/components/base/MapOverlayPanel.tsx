import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { alpha, colors, spacing } from '../../theme/tokens';

export interface MapOverlayPanelProps {
  /** Which map edge the panel hugs. */
  edge: 'top' | 'bottom';
  /** Extra distance from the edge on top of the safe-area inset — e.g. a
   * collapsed BottomSheet's peek height, for a control strip that must
   * clear it. */
  offset?: number;
  /** Fade the map out beneath the panel's chrome — the mockups' HUD zone
   * where street/POI labels die before reaching the floating controls.
   * Without it, map labels render right up under translucent cards and
   * bleed through the gaps. */
  scrim?: boolean;
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
export function MapOverlayPanel({ edge, offset = 0, scrim = false, style, children }: PropsWithChildren<MapOverlayPanelProps>) {
  const insets = useSafeAreaInsets();
  const inset = edge === 'top' ? insets.top : insets.bottom;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.panel, edge === 'top' ? { top: inset + offset } : { bottom: inset + offset }, style]}
    >
      {scrim ? (
        <LinearGradient
          pointerEvents="none"
          colors={
            edge === 'top'
              ? [alpha(colors.charcoal, 0.88), alpha(colors.charcoal, 0.45), alpha(colors.charcoal, 0)]
              : [alpha(colors.charcoal, 0), alpha(colors.charcoal, 0.45), alpha(colors.charcoal, 0.88)]
          }
          locations={[0, 0.62, 1]}
          style={[
            styles.scrim,
            // Bleed past the panel's free edge and the screen padding so the
            // fade covers the whole chrome zone, not just the card bounds.
            edge === 'top' ? { top: -(inset + offset), height: '170%' } : { bottom: 0, height: '170%' },
          ]}
        />
      ) : null}
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
  scrim: {
    position: 'absolute',
    left: -spacing.screenPadding,
    right: -spacing.screenPadding,
  },
});
