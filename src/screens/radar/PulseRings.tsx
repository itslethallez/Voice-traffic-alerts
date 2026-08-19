import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../../theme/colors';

const RING_COUNT = 3;
const RING_DURATION_MS = 2400;
const RING_SIZE = 32;

/** The driver's position on the radar map: a solid dot with concentric
 * rings pulsing outward, staggered so a new one starts as another fades -
 * "radar sweep" read at a glance, no map interaction required. */
export function PulseRings() {
  return (
    <View style={styles.container} pointerEvents="none">
      {Array.from({ length: RING_COUNT }, (_, i) => (
        <PulseRing key={i} delayMs={(RING_DURATION_MS / RING_COUNT) * i} />
      ))}
      <View style={styles.dot} />
    </View>
  );
}

function PulseRing({ delayMs }: { delayMs: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      progress.value = withRepeat(
        withTiming(1, { duration: RING_DURATION_MS, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );
    }, delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.3 + progress.value * 1.7 }],
    opacity: 1 - progress.value,
  }));

  return <Animated.View style={[styles.ring, animatedStyle]} />;
}

const styles = StyleSheet.create({
  container: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.ink,
  },
});
