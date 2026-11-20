import { bearingBetween } from '../geo/bearing';
import type { GeoPoint } from '../geo/types';
import type { DriverState } from '../engine/types';

const METERS_PER_SECOND_TO_KMH = 3.6;

export interface RawLocationSample {
  latitude: number;
  longitude: number;
  /** Degrees, 0-360, or null when the device can't determine heading (expo-location's own shape). */
  heading: number | null;
  /** Metres per second, or null when unavailable. */
  speed: number | null;
}

/**
 * GPS heading is unreliable or absent at low speed (there's no direction
 * of travel to sense), which is common in stop-and-go traffic - not just
 * a rare edge case. expo-location types `heading` as `number | null`,
 * but some platform location APIs it wraps report -1 for "unknown"
 * rather than null, so both are treated as missing here. When the
 * device doesn't give us one, fall back to the bearing between the last
 * position and this one; if there's no previous position either, fall
 * back to the previous heading rather than snapping to due north.
 */
export function toDriverState(sample: RawLocationSample, previous: DriverState | null): DriverState {
  const position: GeoPoint = { latitude: sample.latitude, longitude: sample.longitude };
  const speedKmh = Math.max(0, (sample.speed ?? 0) * METERS_PER_SECOND_TO_KMH);

  let headingDeg = sample.heading;
  let headingReliable = true;
  if (headingDeg === null || headingDeg < 0) {
    if (previous) {
      const moved = position.latitude !== previous.position.latitude ||
        position.longitude !== previous.position.longitude;
      headingDeg = moved ? bearingBetween(previous.position, position) : previous.headingDeg;
      headingReliable = moved || previous.headingReliable !== false;
    } else {
      // No course and nothing to derive one from: 0 is a placeholder, not
      // "north". Flagged so road matching never calls anything "ahead" off
      // it (case E in road/__tests__/aheadCases.test.ts).
      headingDeg = 0;
      headingReliable = false;
    }
  }

  return { position, headingDeg, speedKmh, headingReliable };
}
