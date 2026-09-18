import { BlurView } from 'expo-blur';
import type { PropsWithChildren } from 'react';
import { StyleSheet } from 'react-native';
import type { StyleProp, ViewProps, ViewStyle } from 'react-native';
import { alpha, colors } from '../../theme/tokens';

export interface GlassViewProps extends ViewProps {
  /** Blur intensity 0-100 (default 35 - enough to mute map detail under the
   * card without smearing it into a fog). */
  intensity?: number;
  /** Charcoal veil over the blur, 0-1 alpha. Cards carrying text want more
   * dim than icon buttons - labels stay legible over bright map features. */
  dim?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The §8 "dark translucent surface" from the design guide: real backdrop
 * blur over the map plus a charcoal veil, in place of the near-opaque
 * surfaces the first pass used. Wraps expo-blur's BlurView - Android gets
 * real blur via experimentalBlurMethod, web renders backdrop-filter, iOS
 * uses the native UIVisualEffectView.
 *
 * Children render normally inside the blur (no overlay Views needed): the
 * blur samples what's behind the view, and `backgroundColor` doubles as
 * the dim layer because it draws over the blurred backdrop.
 *
 * Perf note: each BlurView is a live blur pass - on mid-range Android,
 * dimezisBlurView cost scales with on-screen blurred area. Chrome uses it
 * for cards/buttons only; never wrap the whole screen.
 */
export function GlassView({ intensity = 35, dim = 0.35, style, children, ...viewProps }: PropsWithChildren<GlassViewProps>) {
  return (
    <BlurView
      intensity={intensity}
      tint="dark"
      experimentalBlurMethod="dimezisBlurView"
      style={[styles.base, { backgroundColor: alpha(colors.charcoal, dim) }, style]}
      {...viewProps}
    >
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  base: {
    // Clip the blur to the card's border radius.
    overflow: 'hidden',
  },
});
