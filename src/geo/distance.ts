import type { GeoPoint } from './types';

const EARTH_RADIUS_M = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in metres. */
export function haversineDistance(a: GeoPoint, b: GeoPoint): number {
  const phi1 = toRadians(a.latitude);
  const phi2 = toRadians(b.latitude);
  const deltaPhi = toRadians(b.latitude - a.latitude);
  const deltaLambda = toRadians(b.longitude - a.longitude);

  const sinDeltaPhi = Math.sin(deltaPhi / 2);
  const sinDeltaLambda = Math.sin(deltaLambda / 2);

  const h =
    sinDeltaPhi * sinDeltaPhi + Math.cos(phi1) * Math.cos(phi2) * sinDeltaLambda * sinDeltaLambda;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Simple lat/lon average, not a true great-circle midpoint - fine at the
 * announce-distance scale (a few km at most) this is used at, and avoids
 * the antimeridian/pole edge cases a proper spherical midpoint has to
 * handle for no benefit here.
 */
export function midpoint(a: GeoPoint, b: GeoPoint): GeoPoint {
  return {
    latitude: (a.latitude + b.latitude) / 2,
    longitude: (a.longitude + b.longitude) / 2,
  };
}
