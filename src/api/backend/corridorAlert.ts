import type { AlertType } from '../../../shared/alert-schema';
import type { WazeAlert, WazeAlertType } from '../waze/types';
import type { RemoteCorridorAlert } from './types';

/**
 * Normalized-schema type -> the WazeAlertType the announce/dedupe pipeline
 * keys on. Waze's own types map to their existing equivalents (a corridor
 * 'traffic' alert dedupes against a Waze JAM report of the same jam);
 * 'roadkill' has no Waze equivalent and keeps its own 'ROADKILL' type,
 * which the six-pill category filter gates directly.
 */
const CORRIDOR_TYPE_TO_WAZE: Record<AlertType, WazeAlertType> = {
  police: 'POLICE',
  traffic: 'JAM',
  accident: 'ACCIDENT',
  closure: 'ROAD_CLOSED',
  roadkill: 'ROADKILL',
  hazard: 'HAZARD',
};

/**
 * Converts a corridor query row (GET /api/alerts/nearby) into the synthetic
 * WazeAlert shape the announcer, dedupe, and map/feed rendering already
 * handle - the same trick manualReportAlert.ts uses for driver reports, so
 * fused-source alerts flow through every existing code path instead of a
 * parallel one.
 *
 * alert_id is namespaced ('corridor:{uuid}') so a backend alert can never
 * collide with a Waze alert_id or a manual-report localKey in
 * announcedDistances dedupe, marker keys, or the seen-alert tracking.
 *
 * The schema carries no street/city - those stay null/'' and
 * formatAnnouncement.ts's suburb-lookup fallback (prefetched by
 * tripRuntime.ts when alerts land, same as Waze alerts) supplies the area
 * name for speech instead.
 *
 * Returns null for a type outside the normalized enum (a row written by a
 * newer schema version, or a hand-inserted test row): an alert whose
 * category isn't recognized is never shown or announced rather than
 * being mislabelled.
 */
export function corridorAlertToWazeAlert(alert: RemoteCorridorAlert): WazeAlert | null {
  const wazeType = CORRIDOR_TYPE_TO_WAZE[alert.type as AlertType];
  if (!wazeType) return null;

  return {
    alert_id: `corridor:${alert.id}`,
    type: wazeType,
    subtype: null,
    reported_by: null,
    description: null,
    image: null,
    // first_seen drives the announce freshness gate and the sheet's
    // "reported {n}m ago" - an alert near expiry stays showable on the
    // map but ages out of speech on its own via isFreshEnoughToAnnounce.
    publish_datetime_utc: alert.first_seen,
    country: 'AU',
    city: '',
    street: null,
    latitude: alert.lat,
    longitude: alert.lng,
    num_thumbs_up: alert.corroboration_count,
    // The pipeline's corroboration tiebreaks read Waze's 0-10 reliability
    // scale - confidence is the normalized 0-100 version of the same idea.
    alert_reliability: Math.round(alert.confidence / 10),
    alert_confidence: Math.round(alert.confidence / 10),
    near_by: null,
    comments: [],
    num_comments: 0,
  };
}
