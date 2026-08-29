import type { GeoPoint } from './types';

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Initial great-circle bearing from a to b, in degrees, 0-360 (0 = north, clockwise). */
export function bearingBetween(a: GeoPoint, b: GeoPoint): number {
  const phi1 = toRadians(a.latitude);
  const phi2 = toRadians(b.latitude);
  const deltaLambda = toRadians(b.longitude - a.longitude);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  return (toDegrees(theta) + 360) % 360;
}

/**
 * Smallest angle between a heading and a bearing, 0-180 degrees.
 * Handles the 0/360 seam: heading 350 vs bearing 10 is 20 degrees apart,
 * not 340 - a naive `Math.abs(headingDeg - alertBearingDeg)` gets this wrong.
 */
export function bearingDifference(headingDeg: number, alertBearingDeg: number): number {
  const diff = Math.abs(headingDeg - alertBearingDeg) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Signed version of bearingDifference: positive means the bearing is to the
 * right of the heading, negative to the left, in (-180, 180]. Used for
 * "12° LEFT"/"8° RIGHT" wording (RadarMap.tsx's closest-alert focus panel)
 * where bearingDifference's unsigned 0-180 range can't tell which side the
 * alert is on.
 */
export function signedBearingOffset(headingDeg: number, alertBearingDeg: number): number {
  const diff = (((alertBearingDeg - headingDeg) % 360) + 540) % 360;
  return diff - 180;
}

const COMPASS_DIRECTIONS = ['north', 'east', 'south', 'west'] as const;
export type CompassDirection = (typeof COMPASS_DIRECTIONS)[number];

/**
 * Quantizes a heading to the nearest of the 4 cardinal directions, for
 * "-bound" announcement wording (e.g. "northbound"). A finer-grained
 * compass ("northeast") would read awkwardly out loud - drivers know
 * roughly which of 4 directions they're heading, not 8 or 16.
 */
export function compassDirection(headingDeg: number): CompassDirection {
  const normalized = ((headingDeg % 360) + 360) % 360;
  const index = Math.round(normalized / 90) % 4;
  return COMPASS_DIRECTIONS[index];
}
