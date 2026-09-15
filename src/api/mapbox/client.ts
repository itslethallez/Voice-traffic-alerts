import { env } from '../../config/env';
import type { GeoPoint } from '../../geo/types';
import type { MapboxDirectionsResponse, MapboxGeocodeFeature, MapboxGeocodeResponse } from './types';

export class MapboxApiError extends Error {
  status: number | null;
  isRateLimited: boolean;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'MapboxApiError';
    this.status = status;
    this.isRateLimited = status === 429;
  }
}

/** Trailing slash deliberate - see env.ts's withTrailingSlash doc comment on
 * why new URL(relative, base) needs one to append rather than replace.
 * driving-traffic (not plain driving) factors in current and historic
 * traffic conditions - what actually makes a 'quickest' route choice mean
 * anything, and improves the ETA math everywhere else in the app too. */
const DIRECTIONS_BASE_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving-traffic/';
/** Search Box API's one-shot forward search - unlike Geocoding v6 (used
 * previously), this covers POI/business names as well as addresses, and
 * (unlike Search Box's own /suggest+/retrieve pair) needs no session_token
 * since it's a single request. */
const GEOCODE_URL = 'https://api.mapbox.com/search/searchbox/v1/forward';
/** Every destination search is scoped to Australia - see fetchGeocode. */
const GEOCODE_COUNTRY = 'AU';

/** Mapbox coordinate order is [longitude, latitude] - opposite of this
 * app's GeoPoint - everywhere a request is built. */
function formatCoordinate(point: GeoPoint): string {
  return `${point.longitude},${point.latitude}`;
}

export interface FetchDirectionsOptions {
  /** Requests up to Mapbox's usual 2-3 candidate routes instead of just the
   * one it would pick itself - the hazard-avoidance scorer needs more than
   * one option to choose between. Defaults on since that's the only reason
   * this app calls Directions at all. */
  alternatives?: boolean;
  /** Mapbox's `exclude` param, e.g. 'motorway' for sidestreets-only routing
   * (routeSelection.ts's routeTypeToRequestOptions). Comma-separate for
   * more than one value; omitted entirely when undefined. */
  exclude?: string;
  signal?: AbortSignal;
}

/**
 * Point-to-point (or multi-waypoint) driving directions. `waypoints` needs
 * at least an origin and a destination - Mapbox rejects anything shorter
 * with a non-Ok response, surfaced the same way as any other failure below.
 */
export async function fetchDirections(
  waypoints: readonly GeoPoint[],
  { alternatives = true, exclude, signal }: FetchDirectionsOptions = {}
): Promise<MapboxDirectionsResponse> {
  const coordinates = waypoints.map(formatCoordinate).join(';');
  const url = new URL(coordinates, DIRECTIONS_BASE_URL);
  url.searchParams.set('alternatives', String(alternatives));
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('steps', 'true');
  url.searchParams.set('overview', 'full');
  if (exclude) {
    url.searchParams.set('exclude', exclude);
  }
  url.searchParams.set('access_token', env.mapboxAccessToken);

  let response: Response;
  try {
    response = await fetch(url.toString(), { signal });
  } catch {
    throw new MapboxApiError('Network request to the Mapbox Directions API failed', null);
  }

  if (!response.ok) {
    throw new MapboxApiError(`Mapbox Directions API request failed with status ${response.status}`, response.status);
  }

  const body = (await response.json()) as MapboxDirectionsResponse;
  if (body.code !== 'Ok') {
    throw new MapboxApiError(`Mapbox Directions API returned code ${body.code}`, response.status);
  }
  return body;
}

export interface FetchGeocodeOptions {
  /** Biases (not restricts) results toward this point - the driver's
   * current position, so searching "Main St" finds the nearby one first. */
  proximity?: GeoPoint;
  limit?: number;
  signal?: AbortSignal;
}

/** Forward search (address or business/POI name -> coordinates) for
 * destination search, via Mapbox's Search Box API. Always scoped to
 * Australia (GEOCODE_COUNTRY) - every address and business this app cares
 * about is there, and it keeps an unrelated same-named result overseas
 * from ever outranking the local one. */
export async function fetchGeocode(
  query: string,
  { proximity, limit = 5, signal }: FetchGeocodeOptions = {}
): Promise<MapboxGeocodeFeature[]> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('country', GEOCODE_COUNTRY);
  url.searchParams.set('access_token', env.mapboxAccessToken);
  if (proximity) {
    url.searchParams.set('proximity', formatCoordinate(proximity));
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), { signal });
  } catch {
    throw new MapboxApiError('Network request to the Mapbox Geocoding API failed', null);
  }

  if (!response.ok) {
    throw new MapboxApiError(`Mapbox Geocoding API request failed with status ${response.status}`, response.status);
  }

  const body = (await response.json()) as MapboxGeocodeResponse;
  return body.features ?? [];
}
