/**
 * Shapes verified against Mapbox's Directions v5 (driving-traffic profile)
 * and Search Box v1 (/forward) API docs. Only the fields this app actually
 * reads are typed - both responses carry a lot more than this (alternate
 * geometry encodings, congestion annotations, context arrays, POI metadata
 * like hours/phone/rating, etc.) that nothing here needs yet.
 */

export interface MapboxGeoJsonLineString {
  type: 'LineString';
  /** [longitude, latitude] pairs, per GeoJSON's own axis order (opposite of
   * this app's GeoPoint) - callers converting into GeoPoint must swap. */
  coordinates: [number, number][];
}

export interface MapboxManeuver {
  /** Human-readable, e.g. "Turn left onto Main St" - Mapbox already
   * localizes this, so it's used as-is rather than reconstructed from
   * `type`/`modifier`. */
  instruction: string;
  type: string;
  modifier?: string;
  location: [number, number];
}

export interface MapboxRouteStep {
  maneuver: MapboxManeuver;
  /** Metres covered by this step. */
  distance: number;
  /** Seconds estimated for this step. */
  duration: number;
  name: string;
  geometry: MapboxGeoJsonLineString;
}

export interface MapboxRouteLeg {
  steps: MapboxRouteStep[];
  distance: number;
  duration: number;
  summary: string;
}

export interface MapboxRoute {
  geometry: MapboxGeoJsonLineString;
  legs: MapboxRouteLeg[];
  /** Metres, whole route. */
  distance: number;
  /** Seconds, whole route. */
  duration: number;
  weight: number;
  weight_name: string;
}

export interface MapboxDirectionsResponse {
  /** "Ok" on success; "NoRoute" / "NoSegment" / etc. on a request Mapbox
   * understood but couldn't satisfy - distinct from an HTTP-level failure,
   * which throws MapboxApiError before this is ever parsed. */
  code: string;
  routes: MapboxRoute[];
  waypoints: { location: [number, number]; name: string }[];
}

export interface MapboxGeocodeFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    mapbox_id?: string;
    full_address?: string;
    name?: string;
    place_formatted?: string;
    /** e.g. 'poi', 'address', 'place' - present on Search Box API results;
     * not read anywhere yet, kept for a future "business vs address" icon. */
    feature_type?: string;
    /** e.g. ['restaurant'] - only present for feature_type 'poi'. */
    poi_category?: string[];
    [key: string]: unknown;
  };
}

export interface MapboxGeocodeResponse {
  type: 'FeatureCollection';
  features: MapboxGeocodeFeature[];
}

/**
 * One row of a Search Box /suggest response - the autocomplete half of the
 * suggest+retrieve pair. A suggestion deliberately carries no geometry:
 * coordinates only come back from /retrieve once the driver picks a row.
 */
export interface MapboxSearchSuggestion {
  /** Display name - what the driver typed toward ("Rundle Mall",
   * "Adelaide Railway Station", "12 King William St"). */
  name: string;
  name_preferred?: string;
  /** Opaque id passed to /retrieve to get the full feature. */
  mapbox_id: string;
  /** 'poi' for businesses/named places, 'category' for generic categories,
   * otherwise an address-hierarchy type ('address', 'street', 'place',
   * 'locality', 'neighborhood', 'district', 'postcode', 'city', ...). */
  feature_type: string;
  /** Street-line portion only, e.g. "12 King William Street". */
  address?: string;
  full_address?: string;
  /** Context line after the address - "Adelaide, South Australia 5000,
   * Australia". */
  place_formatted?: string;
  maki?: string;
  /** Display strings like "Park", "Train station" - only on POIs. */
  poi_category?: string[];
  /** Canonical ids like "train_station" - only on POIs. */
  poi_category_ids?: string[];
  /** Approximate metres from the request's proximity point (or `origin`
   * when that was supplied instead). Absent when no proximity was sent. */
  distance?: number;
  [key: string]: unknown;
}

export interface MapboxSuggestResponse {
  suggestions: MapboxSearchSuggestion[];
  attribution?: string;
}
