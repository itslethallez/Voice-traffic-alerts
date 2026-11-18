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

/** The point on segment a->b closest to `point`, as a GeoPoint. */
function closestPointOnSegment(point: GeoPoint, a: GeoPoint, b: GeoPoint): GeoPoint {
  const p = toLocalMeters(a, point);
  const end = toLocalMeters(a, b);
  const segmentLengthSq = end.x * end.x + end.y * end.y;

  // a and b coincide (a degenerate zero-length segment, e.g. duplicate
  // consecutive route-geometry points) - nothing to project onto.
  if (segmentLengthSq === 0) return a;

  const t = Math.max(0, Math.min(1, (p.x * end.x + p.y * end.y) / segmentLengthSq));
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

/** Closest distance from `point` to the segment a->b, in metres. */
function distanceToSegment(point: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  return haversineDistance(point, closestPointOnSegment(point, a, b));
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

/**
 * The point on `polyline` nearest to `point` - the projection onto the
 * closest segment, not just the nearest vertex. Used to draw the driver
 * marker snapped onto the route line while navigating: a cheap "close
 * enough" snap, not map matching - it has no idea which road the raw GPS
 * fix is actually on, so a genuinely off-route position gets dragged onto
 * the line anyway until navigationRuntime's deviation check reroutes.
 * Returns `point` unchanged for an empty polyline.
 */
export function nearestPointOnPolyline(point: GeoPoint, polyline: readonly GeoPoint[]): GeoPoint {
  if (polyline.length === 0) return point;
  if (polyline.length === 1) return polyline[0];

  let closest = polyline[0];
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polyline.length - 1; i++) {
    const candidate = closestPointOnSegment(point, polyline[i], polyline[i + 1]);
    const distance = haversineDistance(point, candidate);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = candidate;
    }
  }
  return closest;
}
