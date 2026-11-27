import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTripStore } from '../../store/useTripStore';
import { getCachedSpeedLimit, prefetchSpeedLimit } from '../../geo/speedLimitLookup';
import { colors, radii, shadows, sizes, spacing, typography } from '../../theme/tokens';

/**
 * The map's speed roundel (Stage 8 mockup, board 1): one 76px dial with
 * the current GPS speed in big numerals and "km/h · 60" beneath when the
 * posted limit for the driver's road is known. The ring turns amber when
 * the driver is over that limit.
 *
 * The limit is only shown when actually resolved (getCachedSpeedLimit;
 * Overpass/OSM maxspeed on major roads) - no fabricated default, so on
 * residential or untagged streets the unit line is just "km/h". The
 * lookup is fire-and-forget per position fix, quantized to ~100m cells by
 * speedLimitLookup.ts, so repeat polls over the same stretch cost nothing.
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

  const speed = Math.round(speedKmh);
  const overLimit = speedLimitKmh !== null && speed > speedLimitKmh;
  const unitLine = speedLimitKmh !== null ? `km/h · ${speedLimitKmh}` : 'km/h';
  const label =
    speedLimitKmh !== null
      ? `${speed} kilometres per hour, limit ${speedLimitKmh}${overLimit ? ', over the limit' : ''}`
      : `${speed} kilometres per hour`;

  return (
    <View style={[styles.roundel, overLimit && styles.roundelOver]} accessible accessibilityLabel={label}>
      <Text style={styles.speedValue}>{speed}</Text>
      <Text style={[styles.speedUnit, overLimit && styles.speedUnitOver]}>{unitLine}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  roundel: {
    width: sizes.roundel,
    height: sizes.roundel,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: spacing.xxs,
    borderColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.chrome,
  },
  roundelOver: {
    borderColor: colors.caution,
  },
  speedValue: {
    fontFamily: typography.fontFamily.heavy,
    fontSize: typography.fontSize.roundel,
    lineHeight: typography.fontSize.roundel + spacing.xxs,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  speedUnit: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.micro,
    color: colors.textSecondary,
  },
  speedUnitOver: {
    color: colors.caution,
  },
});
