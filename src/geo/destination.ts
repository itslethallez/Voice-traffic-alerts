import type { GeoPoint } from './types';

const EARTH_RADIUS_M = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Point reached by travelling `distanceMeters` from `start` along the
 * great-circle bearing `bearingDegrees`. Used by boundingBox() to convert
 * metre offsets to lat/lon - this is what keeps the box correctly sized
 * in real metres regardless of latitude, instead of applying the same
 * degree delta to both axes (see boundingBox.ts).
 */
export function destinationPoint(
  start: GeoPoint,
  distanceMeters: number,
  bearingDegrees: number
): GeoPoint {
  const delta = distanceMeters / EARTH_RADIUS_M;
  const theta = toRadians(bearingDegrees);
  const phi1 = toRadians(start.latitude);
  const lambda1 = toRadians(start.longitude);

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
    );

  return {
    latitude: toDegrees(phi2),
    longitude: toDegrees(lambda2),
  };
}
