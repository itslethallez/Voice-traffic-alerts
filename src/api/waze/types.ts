/**
 * Shape verified against the OpenWeb Ninja Waze API docs
 * (https://www.openwebninja.com/api/waze/docs and
 * https://www.openwebninja.com/api/waze), cross-checked against a
 * verbatim sample response from a mirror of the same API
 * (https://zylalabs.com/api-marketplace/travel/waze+alerts+and+jams+information+api/1910).
 *
 * `type` is known to include at least POLICE, JAM, ROAD_CLOSED and HAZARD
 * from the documented examples; ACCIDENT is the standard Waze category and
 * is included per the product spec, but the field is typed as a union with
 * a `string & {}` fallback so an unrecognized value from the live API
 * never fails to parse.
 */
export type WazeAlertType =
  | 'POLICE'
  | 'ACCIDENT'
  | 'HAZARD'
  | 'ROAD_CLOSED'
  | 'JAM'
  | (string & {});

export interface WazeAlertComment {
  text?: string;
  report_millis?: number;
  [key: string]: unknown;
}

export interface WazeAlert {
  alert_id: string;
  type: WazeAlertType;
  subtype: string | null;
  reported_by: string | null;
  description: string | null;
  image: string | null;
  /** ISO 8601 UTC timestamp, e.g. "2025-01-25T10:28:28.000Z" */
  publish_datetime_utc: string;
  country: string;
  city: string;
  street: string;
  latitude: number;
  longitude: number;
  num_thumbs_up: number;
  alert_reliability: number;
  alert_confidence: number;
  near_by: string | null;
  comments: WazeAlertComment[];
  num_comments: number;
}

export interface WazeJam {
  [key: string]: unknown;
}

export interface WazeAlertsResponseParameters {
  bottom_left: string | [string, string];
  top_right: string | [string, string];
  max_alerts: number;
  max_jams: number;
}

export interface WazeAlertsResponse {
  status: string;
  request_id: string;
  parameters: WazeAlertsResponseParameters;
  data: {
    alerts: WazeAlert[];
    jams: WazeJam[];
  };
}

export interface WazeBoundingBox {
  /** Bottom-left corner as "lat,lon" */
  bottomLeft: { lat: number; lon: number };
  /** Top-right corner as "lat,lon" */
  topRight: { lat: number; lon: number };
}
