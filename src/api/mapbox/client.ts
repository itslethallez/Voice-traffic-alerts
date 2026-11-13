import { env } from '../../config/env';
import type { GeoPoint } from '../../geo/types';
import type {
  MapboxDirectionsResponse,
  MapboxGeocodeFeature,
  MapboxGeocodeResponse,
  MapboxSearchSuggestion,
  MapboxSuggestResponse,
} from './types';

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
/** The interactive-search pair: /suggest feeds autocomplete rows as the
 * driver types, /retrieve resolves the picked row's mapbox_id into a full
 * feature (the only place coordinates come from). Both calls in one search
 * session share a caller-generated session_token - Mapbox bills the whole
 * exchange as a single session, so the token is regenerated after every
 * retrieve. */
const SUGGEST_URL = 'https://api.mapbox.com/search/searchbox/v1/suggest';
/** Trailing slash so `${RETRIEVE_BASE_URL}${mapboxId}` appends the id as a
 * new path segment rather than replacing 'retrieve'. */
const RETRIEVE_BASE_URL = 'https://api.mapbox.com/search/searchbox/v1/retrieve/';
/** /suggest is asked only for feature types that resolve to a single
 * routable point: 'category' suggestions ("Petrol station") retrieve to a
 * category, not a coordinate, and country/region results are too coarse to
 * navigate to. Concrete POIs of that category still surface via 'poi'. */
const SUGGEST_TYPES = 'address,street,poi,place,city,locality,neighborhood,district,postcode';
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

export interface FetchSuggestionsOptions {
  /** Caller-generated UUIDv4 grouping this session's suggest calls and the
   * one retrieve that follows - required by the endpoint and what makes
   * the whole exchange bill as a single session. */
  sessionToken: string;
  /** Biases (not restricts) results toward this point - the driver's
   * current position, so "Main St" finds the nearby one first. Also makes
   * each suggestion carry a `distance` in metres. */
  proximity?: GeoPoint;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Autocomplete-as-you-type: returns address, business and named-place
 * (park/station/landmark) suggestions in one query, biased to `proximity`
 * and scoped to Australia like fetchGeocode. Suggestions carry no
 * coordinates - retrieveSuggestion resolves the picked one.
 */
export async function fetchSearchSuggestions(
  query: string,
  { sessionToken, proximity, limit = 8, signal }: FetchSuggestionsOptions
): Promise<MapboxSearchSuggestion[]> {
  const url = new URL(SUGGEST_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('session_token', sessionToken);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('country', GEOCODE_COUNTRY);
  url.searchParams.set('types', SUGGEST_TYPES);
  url.searchParams.set('access_token', env.mapboxAccessToken);
  if (proximity) {
    url.searchParams.set('proximity', formatCoordinate(proximity));
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), { signal });
  } catch {
    throw new MapboxApiError('Network request to the Mapbox Search API failed', null);
  }

  if (!response.ok) {
    throw new MapboxApiError(`Mapbox Search API request failed with status ${response.status}`, response.status);
  }

  const body = (await response.json()) as MapboxSuggestResponse;
  return body.suggestions ?? [];
}

export interface RetrieveSuggestionOptions {
  /** Must be the same token the /suggest calls in this session used -
   * reusing it is what makes the retrieve bill as part of the session
   * rather than as a second session. */
  sessionToken: string;
  signal?: AbortSignal;
}

/**
 * Resolves a picked suggestion's mapbox_id into the full feature - the
 * only step that returns coordinates. Returns null when the response has
 * no usable feature (a failed retrieve isn't thrown: the caller just has
 * nothing to navigate to, same as an empty suggestion list).
 */
export async function retrieveSuggestion(
  mapboxId: string,
  { sessionToken, signal }: RetrieveSuggestionOptions
): Promise<MapboxGeocodeFeature | null> {
  const url = new URL(`${RETRIEVE_BASE_URL}${encodeURIComponent(mapboxId)}`);
  url.searchParams.set('session_token', sessionToken);
  url.searchParams.set('access_token', env.mapboxAccessToken);

  let response: Response;
  try {
    response = await fetch(url.toString(), { signal });
  } catch {
    throw new MapboxApiError('Network request to the Mapbox Search API failed', null);
  }

  if (!response.ok) {
    throw new MapboxApiError(`Mapbox Search API retrieve failed with status ${response.status}`, response.status);
  }

  const body = (await response.json()) as MapboxGeocodeResponse;
  return body.features?.[0] ?? null;
}
