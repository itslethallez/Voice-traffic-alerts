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
