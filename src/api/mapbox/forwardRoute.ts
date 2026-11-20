import { env } from '../../config/env';
import type { GeoPoint } from '../../geo/types';
import { requestJsonWithNativeTimeout } from '../nativeTimeoutRequest';

/**
 * One Mapbox Directions request: the drive from where the driver is, in
 * the direction they're already heading, to one alert. Everything road
 * matching needs comes out of this single response - the road the driver
 * is on (the first step's name), whether the alert is on it or its
 * continuation (no turn off before arriving), and the distance along the
 * road. No separate Map Matching call.
 *
 * `bearings=<heading>,45` on the origin stops Mapbox from starting the
 * route by driving backwards; an alert behind the driver then comes back
 * as a route with a U-turn in it, which road/classifyRoute.ts reads as
 * "behind". Plain `driving` profile: traffic doesn't change which road an
 * alert is on, and it's the same price.
 *
 * Billing: one Directions API request per call (see the Stage 3 PR notes
 * for the per-user estimate). Callers ration it - road/roadContextRuntime.ts.
 */

const DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving/';

/** Directions usually answers in 200-600ms; a lookup still out after this
 * just leaves the alert on the "nearby" wording. Native timeout - see
 * api/nativeTimeoutRequest.ts. */
export const FORWARD_ROUTE_TIMEOUT_MS = 4_000;

/** Mapbox's own bearing tolerance for the origin, degrees either side. */
const ORIGIN_BEARING_RANGE_DEG = 45;

export interface ForwardRouteStep {
  /** Road name for this step ("" when Mapbox has none). */
  name: string;
  /** Mapbox maneuver type: depart, turn, continue, new name, merge, fork,
   * roundabout, rotary, end of road, arrive, ... */
  maneuverType: string;
  /** straight, slight left, left, sharp left, uturn, ... (may be absent). */
  modifier: string | null;
  distanceMeters: number;
}

export interface ForwardRoute {
  /** [origin ... snapped destination] */
  polyline: GeoPoint[];
  distanceMeters: number;
  steps: ForwardRouteStep[];
  /** How far Mapbox had to move the alert to put it on a road. */
  destinationSnapMeters: number;
  /** Served from the server's shared cache (another driver's request) -
   * starts wherever that driver was, not necessarily here. */
  shared?: boolean;
  /** Which router the server used (Valhalla first, Mapbox fallback).
   * Absent for a direct Mapbox call from the app. */
  router?: 'valhalla' | 'mapbox';
}

export interface DirectionsBody {
  code: string;
  routes?: Array<{
    distance: number;
    geometry: { coordinates: [number, number][] };
    legs: Array<{
      steps: Array<{ name?: string; distance: number; maneuver: { type: string; modifier?: string } }>;
    }>;
  }>;
  waypoints?: Array<{ distance?: number }>;
}

/**
 * Server-first: Shotgun's /api/road/forward-route shares one Mapbox route
 * per alert among every driver approaching it along the same road (see
 * server/api/road/forward-route.ts), which is what keeps Directions cost
 * flat as users grow. When the server isn't configured (no
 * EXPO_PUBLIC_BACKEND_API_URL - true for every build so far) or fails,
 * this asks Mapbox directly, so road matching never depends on it.
 */
export async function fetchForwardRoute(
  from: GeoPoint,
  headingDeg: number,
  to: GeoPoint,
  signal?: AbortSignal
): Promise<ForwardRoute> {
  if (env.backendApiBaseUrl) {
    try {
      return await fetchSharedForwardRoute(from, headingDeg, to, signal);
    } catch (error) {
      console.warn(`[road] shared route unavailable, asking Mapbox directly: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return fetchDirectForwardRoute(from, headingDeg, to, signal);
}

async function fetchSharedForwardRoute(
  from: GeoPoint,
  headingDeg: number,
  to: GeoPoint,
  signal?: AbortSignal
): Promise<ForwardRoute> {
  const params = new URLSearchParams({
    fromLat: String(from.latitude),
    fromLng: String(from.longitude),
    heading: String(Math.round(((headingDeg % 360) + 360) % 360)),
    toLat: String(to.latitude),
    toLng: String(to.longitude),
  });
  const body = await requestJsonWithNativeTimeout<{ directions: DirectionsBody; cache: 'hit' | 'miss'; router?: 'valhalla' | 'mapbox' }>({
    method: 'GET',
    url: `${env.backendApiBaseUrl}api/road/forward-route?${params.toString()}`,
    timeoutMs: FORWARD_ROUTE_TIMEOUT_MS,
    signal,
  });
  return { ...parseForwardRoute(body.directions), shared: body.cache === 'hit', router: body.router ?? 'mapbox' };
}

async function fetchDirectForwardRoute(
  from: GeoPoint,
  headingDeg: number,
  to: GeoPoint,
  signal?: AbortSignal
): Promise<ForwardRoute> {
  const coords = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
  const params = new URLSearchParams({
    alternatives: 'false',
    geometries: 'geojson',
    overview: 'full',
    steps: 'true',
    bearings: `${Math.round(((headingDeg % 360) + 360) % 360)},${ORIGIN_BEARING_RANGE_DEG};`,
    access_token: env.mapboxAccessToken,
  });
  const body = await requestJsonWithNativeTimeout<DirectionsBody>({
    method: 'GET',
    url: `${DIRECTIONS_URL}${coords}?${params.toString()}`,
    timeoutMs: FORWARD_ROUTE_TIMEOUT_MS,
    signal,
  });
  return parseForwardRoute(body);
}

export function parseForwardRoute(body: DirectionsBody): ForwardRoute {
  const route = body.routes?.[0];
  if (body.code !== 'Ok' || !route) throw new Error(`Mapbox Directions returned ${body.code}`);
  return {
    polyline: route.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude })),
    distanceMeters: route.distance,
    steps: route.legs.flatMap((leg) =>
      leg.steps.map((step) => ({
        name: step.name ?? '',
        maneuverType: step.maneuver.type,
        modifier: step.maneuver.modifier ?? null,
        distanceMeters: step.distance,
      }))
    ),
    destinationSnapMeters: body.waypoints?.[1]?.distance ?? 0,
  };
}
