import { haversineDistance } from '../geo/distance';
import type { GeoPoint } from '../geo/types';
import type { WazeAlert } from '../api/waze/types';
import { LIVE_REPORT_WINDOW_MS } from './manualReportAlert';
import type { NearbyReport } from './useTripStore';

/**
 * The "other devices' reports" counterpart of manualReportAlert.ts's
 * manualReportToWazeAlert - same synthetic-WazeAlert trick so the map and
 * feed render these with zero new rendering logic, just a different source
 * list. alert_id is the report's real backend id (there's no local-id-swap
 * dance here: a NearbyReport only ever exists as an already-synced row
 * fetched fresh from the backend, never created optimistically on this
 * device).
 */
export function nearbyReportToWazeAlert(report: NearbyReport): WazeAlert {
  return {
    alert_id: report.id,
    type: report.category,
    subtype: report.subtype,
    reported_by: null,
    description: null,
    image: null,
    publish_datetime_utc: new Date(report.createdAtMs).toISOString(),
    country: 'AU',
    city: '',
    street: null,
    latitude: report.position.latitude,
    longitude: report.position.longitude,
    num_thumbs_up: 0,
    alert_reliability: 5,
    alert_confidence: 1,
    near_by: null,
    comments: [],
    num_comments: 0,
  };
}

/**
 * The bounded, render-ready view of nearbyReports for the map and feed -
 * mirrors visibleManualReportAlerts' own age/distance bounds exactly, since
 * both ultimately answer the same question ("is this report still live and
 * close enough to matter right now"), just for reports this device didn't
 * create itself. The backend's own nearby query (fetchNearbyReports) already
 * excludes anything past LIVE_REPORT_WINDOW_MS server-side, so this is a
 * defensive re-check against clock drift between polls, not the primary
 * filter - the same "server does a loose box, client re-checks precisely"
 * split fetchAlertsForBoundingBox uses for Waze's own alerts.
 */
export function visibleNearbyReportAlerts(
  nearbyReports: NearbyReport[],
  driverPosition: GeoPoint | null,
  nowMs: number,
  maxDistanceMeters: number
): WazeAlert[] {
  if (!driverPosition) return [];
  return nearbyReports
    .filter((report) => nowMs - report.lastConfirmedAtMs <= LIVE_REPORT_WINDOW_MS)
    .filter((report) => haversineDistance(driverPosition, report.position) <= maxDistanceMeters)
    .map(nearbyReportToWazeAlert);
}
