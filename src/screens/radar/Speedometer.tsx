import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTripStore } from '../../store/useTripStore';
import { GlassView } from '../../components/base/GlassView';
import { getCachedSpeedLimit, prefetchSpeedLimit } from '../../geo/speedLimitLookup';
import { alpha, colors, radii, spacing, typography } from '../../theme/tokens';

/** The posted-limit roundel's diameter, matched to the design reference's
 * AU speed-limit sign (Im52.png: ~22% of the mockup screen's width). Kept
 * fixed rather than viewport-relative so it can't grow into a corner-dial
 * on tablets. */
const LIMIT_ROUNDEL_SIZE = 84;
/** Real AU limit signs use a heavy red ring (~1/8 of the sign face). */
const LIMIT_RING_WIDTH = 6;

/**
 * The map's speed indicator (design reference Im52.png): a left-edge
 * vertical capsule pairing an Australian speed-limit sign with the
 * current-speed reading beneath it.
 *
 * - Top: the posted limit as a real sign - red ring, white face, bold
 *   dark number, "km/h" beneath. Rendered only when a limit is actually
 *   resolved for the driver's road (getCachedSpeedLimit; Overpass/OSM
 *   maxspeed on major roads). No fabricated default - on residential or
 *   untagged streets the sign half simply doesn't render.
 * - Below: current GPS speed in large white numerals - the part that
 *   always has data (driverSpeedKmh), so it shows even with no fix on a
 *   limit yet.
 *
 * The lookup is fire-and-forget per position fix, quantized to ~100m
 * cells by speedLimitLookup.ts, so repeat polls over the same stretch
 * cost nothing.
 */
export function Speedometer() {
  const speedKmh = useTripStore((state) => state.driverSpeedKmh);
  const driverPosition = useTripStore((state) => state.driverPosition);
  const [speedLimitKmh, setSpeedLimitKmh] = useState<number | null>(null);

  useEffect(() => {
    if (!driverPosition) {
      setSpeedLimitKmh(null);
      return;
    }
    const cached = getCachedSpeedLimit(driverPosition);
    if (cached !== undefined) {
      setSpeedLimitKmh(cached);
      return;
    }
    let alive = true;
    void prefetchSpeedLimit(driverPosition).then(() => {
      if (alive) setSpeedLimitKmh(getCachedSpeedLimit(driverPosition) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [driverPosition]);

  return (
    <GlassView intensity={40} dim={0.45} style={styles.capsule}>
      {speedLimitKmh !== null ? (
        <View
          style={styles.limitRoundel}
          accessible
          accessibilityLabel={`Speed limit ${speedLimitKmh} kilometres per hour`}
        >
          <Text style={styles.limitValue}>{speedLimitKmh}</Text>
          <Text style={styles.limitUnit}>km/h</Text>
        </View>
      ) : null}
      <View
        style={styles.speedHalf}
        accessible
        accessibilityLabel={`Current speed ${Math.round(speedKmh)} kilometres per hour`}
      >
        <Text style={styles.speedValue}>{Math.round(speedKmh)}</Text>
        <Text style={styles.speedUnit}>km/h</Text>
      </View>
    </GlassView>
  );
}

const styles = StyleSheet.create({
  capsule: {
    alignItems: 'center',
    padding: spacing.xs,
    gap: spacing.xs,
    borderRadius: radii.pill,
    // The reference capsule's border is a neutral light ring, not teal -
    // it reads as painted sign hardware, not an interactive control.
    borderWidth: 1,
    borderColor: alpha(colors.textPrimary, 0.3),
  },
  limitRoundel: {
    width: LIMIT_ROUNDEL_SIZE,
    height: LIMIT_ROUNDEL_SIZE,
    borderRadius: LIMIT_ROUNDEL_SIZE / 2,
    backgroundColor: colors.white,
    borderWidth: LIMIT_RING_WIDTH,
    borderColor: colors.critical,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitValue: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.heading,
    lineHeight: typography.fontSize.heading,
    color: colors.charcoal,
    fontVariant: ['tabular-nums'],
  },
  limitUnit: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    color: colors.charcoal,
  },
  speedHalf: {
    alignItems: 'center',
    paddingBottom: spacing.xxs,
  },
  speedValue: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.stat,
    lineHeight: typography.fontSize.stat,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  speedUnit: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textSecondary,
  },
});
