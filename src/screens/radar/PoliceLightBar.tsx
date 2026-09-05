import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, instrument } from '../../theme/colors';

/** Each cell holds its lit colour for this long, then its off colour for
 * this long, in antiphase - measured from the design artboard's
 * copLightBlue/copLightRed keyframes (920ms full cycle). */
const PHASE_DURATION_MS = 460;

const OFF_BLUE = 'rgba(61,107,255,0.18)';
const OFF_RED = 'rgba(255,61,61,0.18)';

/**
 * The one animated, coloured element in the Instrument redesign
 * (design_handoff_instrument_face) - a two-cell police light bar, reserved
 * for POLICE only. Same hard-cut step animation as the shipped
 * PoliceLightsPin (Easing.steps(1, true) + withRepeat reverse:true), just
 * driving two rectangular cells instead of a single pin's border colour -
 * `orientation: 'horizontal'` for the map marker's top strip,
 * `'vertical'` for a ledger row's leading mark. `inverted` swaps the off
 * colour from the translucent blue/red (dark ground) to solid ink (paper
 * ground) - the alpha version would read as pale pink/blue there instead.
 */
export function PoliceLightBar({
  orientation,
  width,
  height,
  inverted = false,
}: {
  orientation: 'horizontal' | 'vertical';
  width: number;
  height: number;
  inverted?: boolean;
}) {
  const phase = useSharedValue(0);

  useEffect(() => {
    phase.value = withRepeat(
      withTiming(1, { duration: PHASE_DURATION_MS, easing: Easing.steps(1, true) }),
      -1,
      true
    );
  }, [phase]);

  const offBlue = inverted ? instrument.ink : OFF_BLUE;
  const offRed = inverted ? instrument.ink : OFF_RED;

  // Glow is animated in antiphase with each cell's own colour: lit -> glow
  // on, off -> glow off, using the same phase value so they never drift
  // out of sync with the colour swap itself.
  const blueCellStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(phase.value, [0, 1], [colors.policeLightBlue, offBlue]),
    shadowOpacity: interpolate(phase.value, [0, 1], [0.85, 0]),
  }));
  const redCellStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(phase.value, [0, 1], [offRed, colors.policeLightRed]),
    shadowOpacity: interpolate(phase.value, [0, 1], [0, 0.85]),
  }));

  return (
    <View
      style={[
        styles.bar,
        { width, height, flexDirection: orientation === 'horizontal' ? 'row' : 'column' },
      ]}
    >
      <Animated.View style={[styles.cell, styles.blueCell, blueCellStyle]} />
      <Animated.View style={[styles.cell, styles.redCell, redCellStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexShrink: 0,
    gap: 2,
  },
  cell: {
    flex: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 6,
    elevation: 6,
  },
  blueCell: {
    shadowColor: colors.policeLightBlue,
  },
  redCell: {
    shadowColor: colors.policeLightRed,
  },
});
