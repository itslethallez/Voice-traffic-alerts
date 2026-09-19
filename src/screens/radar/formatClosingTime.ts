import { STATIONARY_SPEED_THRESHOLD_KMH } from '../../engine/constants';

const METRES_PER_SECOND_PER_KMH = 1000 / 3600;

/**
 * "70 S" / "3 MIN" - how long until the driver reaches an on-path alert at
 * the current speed, for RadarMap.tsx's closest-alert focus panel ("70 S AT
 * 62 KM/H"). Null below STATIONARY_SPEED_THRESHOLD_KMH - "time to arrival"
 * is meaningless standing still, and would otherwise show an ever-growing
 * or infinite value.
 */
export function formatClosingTime(distanceMeters: number, speedKmh: number): string | null {
  if (speedKmh < STATIONARY_SPEED_THRESHOLD_KMH) return null;

  const metresPerSecond = speedKmh * METRES_PER_SECOND_PER_KMH;
  const seconds = distanceMeters / metresPerSecond;

  if (seconds < 90) return `${Math.round(seconds)} S`;
  return `${Math.round(seconds / 60)} MIN`;
}
