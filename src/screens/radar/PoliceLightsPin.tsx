import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../../theme/colors';
import { ALERT_PIN_BORDER_WIDTH, ALERT_PIN_SIZE } from './alertPinSize';

const FLASH_INTERVAL_MS = 300;

/**
 * The radar map's POLICE alert pin (Step 12 #24) - alternates its border
 * and background between blue and red like a police light bar, instead of
 * the static single-color pin every other alert type uses. `Easing.steps(1,
 * true)` jumps to its target immediately (a single step, rounded to the
 * end) rather than fading, so combined with `withRepeat`'s `reverse: true`
 * this snaps hard between the two colors every FLASH_INTERVAL_MS instead of
 * crossfading between them.
 */
export function PoliceLightsPin({ emoji }: { emoji: string }) {
  const phase = useSharedValue(0);

  useEffect(() => {
    phase.value = withRepeat(
      withTiming(1, { duration: FLASH_INTERVAL_MS, easing: Easing.steps(1, true) }),
      -1,
      true
    );
  }, [phase]);

  const animatedStyle = useAnimatedStyle(() => {
    const color = interpolateColor(phase.value, [0, 1], [colors.policeLightBlue, colors.policeLightRed]);
    return { borderColor: color };
  });

  return (
    <Animated.View style={[styles.pin, animatedStyle]}>
      <Text style={styles.emoji}>{emoji}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pin: {
    width: ALERT_PIN_SIZE,
    height: ALERT_PIN_SIZE,
    borderRadius: ALERT_PIN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundAccent,
    borderWidth: ALERT_PIN_BORDER_WIDTH,
  },
  emoji: {
    fontSize: 16,
  },
});
