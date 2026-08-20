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
const DISC_SIZE = 44;

/**
 * The driver's position on the radar map: a two-tone disc with a heading
 * arrow, and concentric rings pulsing outward, staggered so a new one
 * starts as another fades - "radar sweep" read at a glance, no map
 * interaction required. The arrow always points straight up rather than
 * rotating with driverHeadingDeg - RadarMap's Camera already rotates the
 * whole map to heading-up, so "up" already means "the direction the
 * driver is travelling."
 */
export function PulseRings() {
  return (
    <View style={styles.container} pointerEvents="none">
      {Array.from({ length: RING_COUNT }, (_, i) => (
        <PulseRing key={i} delayMs={(RING_DURATION_MS / RING_COUNT) * i} />
      ))}
      <View style={styles.disc}>
        <View style={styles.arrow} />
      </View>
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
    width: RING_SIZE * 2,
    height: RING_SIZE * 2,
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
  disc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: DISC_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentDim,
    borderWidth: 3,
    borderColor: colors.accent,
  },
  arrow: {
    width: 0,
    height: 0,
    marginBottom: 2,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.ink,
  },
});
