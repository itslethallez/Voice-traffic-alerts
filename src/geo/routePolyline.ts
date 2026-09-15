import { haversineDistance } from './distance';
import type { GeoPoint } from './types';

const METERS_PER_DEGREE_LAT = 111_320;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Flat-plane approximation centered on `origin`, scaling longitude by
 * cos(latitude) so a degree of longitude isn't overcounted away from the
 * equator - the same correction destinationPoint()/boundingBox() already
 * make for the reverse conversion. Fine at route-corridor scale (a route
 * leg is at most a few km), same "fine at this scale" tradeoff distance.ts's
 * midpoint() already makes for a simpler true-spherical calculation.
 */
function toLocalMeters(origin: GeoPoint, point: GeoPoint): { x: number; y: number } {
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(toRadians(origin.latitude));
  return {
    x: (point.longitude - origin.longitude) * metersPerDegreeLon,
    y: (point.latitude - origin.latitude) * METERS_PER_DEGREE_LAT,
  };
}

/** Closest distance from `point` to the segment a->b, in metres. */
function distanceToSegment(point: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const p = toLocalMeters(a, point);
  const end = toLocalMeters(a, b);
  const segmentLengthSq = end.x * end.x + end.y * end.y;

  // a and b coincide (a degenerate zero-length segment, e.g. duplicate
  // consecutive route-geometry points) - nothing to project onto.
  if (segmentLengthSq === 0) return haversineDistance(point, a);

  const t = Math.max(0, Math.min(1, (p.x * end.x + p.y * end.y) / segmentLengthSq));
  const closest: GeoPoint = {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
  return haversineDistance(point, closest);
}

/**
 * Closest distance from `point` to any segment of `polyline`, in metres -
 * the building block both route-deviation ("has the driver left the
 * route?") and hazard-exposure ("is this alert near the route?") checks
 * need. Nothing like this existed before: selectClosestOnPathAlert.ts and
 * selectSpeedCameraWarning.ts are both cone/bearing checks from a single
 * driver point, not point-to-polyline geometry.
 */
export function distanceToPolyline(point: GeoPoint, polyline: readonly GeoPoint[]): number {
  if (polyline.length === 0) return Number.POSITIVE_INFINITY;
  if (polyline.length === 1) return haversineDistance(point, polyline[0]);

  let closest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polyline.length - 1; i++) {
    const distance = distanceToSegment(point, polyline[i], polyline[i + 1]);
    if (distance < closest) closest = distance;
  }
  return closest;
}
