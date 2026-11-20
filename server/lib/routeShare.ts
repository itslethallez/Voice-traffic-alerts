/**
 * Shared forward routes for road matching (api/road/forward-route.ts).
 *
 * The app asks "how do I get from here, heading this way, to this alert?"
 * (src/road/roadContextRuntime.ts). Every driver approaching the same alert
 * along the same road gets the same answer - only how far along the route
 * they are differs, and the app works that out itself by projecting its
 * position onto the route. So one Mapbox Directions call per alert per
 * approach serves everyone on that road segment: a cached route is reused
 * for a request whose origin lies on it, before the alert, heading the way
 * the route runs.
 *
 * Pure geometry, no I/O - the handler owns Redis and Mapbox.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** The subset of a Mapbox Directions response the app parses
 * (src/api/mapbox/forwardRoute.ts's parseForwardRoute). */
export interface StoredDirections {
  code: string;
  routes: Array<{
    distance: number;
    geometry: { coordinates: [number, number][] };
    legs: Array<{ steps: Array<{ name?: string; distance: number; maneuver: { type: string; modifier?: string } }> }>;
  }>;
  waypoints?: Array<{ distance?: number }>;
}

/** Origin further than this from a cached route isn't on it. */
export const SHARE_MAX_OFFSET_METERS = 40;
/** Driver heading vs the route's direction at that point. */
export const SHARE_MAX_HEADING_DIFF_DEG = 45;
/** Must be at least this far short of the alert to reuse the route. */
export const SHARE_MIN_REMAINING_METERS = 100;

const EARTH_RADIUS_M = 6_371_000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function headingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * If `origin` (heading `headingDeg`) lies on this stored route before its
 * end, returns how far along it is; otherwise null.
 */
export function progressOnRoute(directions: StoredDirections, origin: LatLng, headingDeg: number): number | null {
  const route = directions.routes[0];
  if (!route) return null;
  const pts = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  const mPerLat = 111_320;
  const mPerLng = 111_320 * Math.cos(toRad(origin.lat));
  let best: { offset: number; progress: number; segBearing: number } | null = null;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segLen = haversineMeters(a, b);
    const ax = (a.lng - origin.lng) * mPerLng;
    const ay = (a.lat - origin.lat) * mPerLat;
    const dx = (b.lng - a.lng) * mPerLng;
    const dy = (b.lat - a.lat) * mPerLat;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
    const offset = Math.hypot(ax + t * dx, ay + t * dy);
    if (!best || offset < best.offset) best = { offset, progress: acc + t * segLen, segBearing: bearingDeg(a, b) };
    acc += segLen;
  }
  if (!best || best.offset > SHARE_MAX_OFFSET_METERS) return null;
  if (headingDiff(best.segBearing, headingDeg) > SHARE_MAX_HEADING_DIFF_DEG) return null;
  if (acc - best.progress < SHARE_MIN_REMAINING_METERS) return null;
  return best.progress;
}

/** First stored route this origin can reuse, or null. */
export function findShareableRoute(
  stored: readonly StoredDirections[],
  origin: LatLng,
  headingDeg: number
): StoredDirections | null {
  for (const directions of stored) {
    if (progressOnRoute(directions, origin, headingDeg) !== null) return directions;
  }
  return null;
}

/** Drops everything the app doesn't parse - keeps Redis values small. */
export function trimDirections(body: StoredDirections): StoredDirections {
  return {
    code: body.code,
    routes: body.routes.slice(0, 1).map((r) => ({
      distance: r.distance,
      geometry: { coordinates: r.geometry.coordinates },
      legs: r.legs.map((leg) => ({
        steps: leg.steps.map((s) => ({
          name: s.name,
          distance: s.distance,
          maneuver: s.maneuver.modifier
            ? { type: s.maneuver.type, modifier: s.maneuver.modifier }
            : { type: s.maneuver.type },
        })),
      })),
    })),
    waypoints: body.waypoints?.map((w) => ({ distance: w.distance })),
  };
}

/** One key per alert position (~1m), so the same alert from any source
 * shares, and nothing else does. */
export function shareKey(to: LatLng): string {
  return `road:v1:${to.lat.toFixed(5)}:${to.lng.toFixed(5)}`;
}
