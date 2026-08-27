import { haversineDistance } from '../geo/distance';
import type { GeoPoint } from '../geo/types';
import type { WazeAlert } from '../api/waze/types';
import type { ManualReport } from './useTripStore';

/**
 * How long a submitted report is still treated as a live hazard on the map
 * and nearby-alerts feed. manualReports itself stays hydrated from the
 * backend indefinitely (useTripStore.ts, for History's benefit), so
 * without this cutoff a report from an earlier trip would resurface as a
 * current sighting every time the app relaunches near that spot.
 */
const LIVE_REPORT_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Converts a driver-submitted report into the minimal synthetic WazeAlert
 * shape the map (RadarMap.tsx's AlertMarker) and the feed
 * (DriveScreen.tsx's AlertLedgerRow) already know how to render - reuses
 * every existing marker/row/confidence-label code path instead of building
 * parallel rendering just for reports. Previously nothing read
 * manualReports at all, so a submitted report had no visible trace beyond
 * History.
 *
 * Only called for reports with a known position - a report with no
 * location doesn't sync to the backend either (useTripStore.ts), and has
 * nowhere sensible to place a marker or compute a feed distance from.
 *
 * alert_id is the report's localKey, not its id - id gets swapped from a
 * local placeholder to the backend's real id once pushManualReport's
 * background sync succeeds (useTripStore.ts), and using it directly here
 * would make a successfully-synced report look like a brand new alert to
 * RadarMap's seenAlertIds tracking and to React's list keys.
 */
export function manualReportToWazeAlert(report: ManualReport & { position: NonNullable<ManualReport['position']> }): WazeAlert {
  return {
    alert_id: report.localKey,
    type: 'POLICE',
    subtype: null,
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
    // Neutral placeholder - no client-side corroboration data exists yet
    // for the app's own manual reports (only Waze's own alerts carry real
    // reliability/thumbs-up figures).
    alert_reliability: 5,
    alert_confidence: 1,
    near_by: null,
    comments: [],
    num_comments: 0,
  };
}

/**
 * The bounded, render-ready view of manualReports for the map and feed:
 * only reports with a known position, still within LIVE_REPORT_MAX_AGE_MS,
 * and within maxDistanceMeters of the driver's current position - the same
 * "nearby and current" scope Waze's own alerts already have for free (each
 * poll fetches only what's within that radius of wherever the driver is
 * right now). manualReports itself has neither bound (it's a
 * backend-hydrated, all-time-by-device list kept for History), so without
 * this, DriveScreen.tsx's feed and RadarMap.tsx's markers/new-alert
 * spotlight would treat every report the device has ever filed - including
 * ones from other trips, in other places - as a live hazard right now.
 */
export function visibleManualReportAlerts(
  manualReports: ManualReport[],
  driverPosition: GeoPoint | null,
  nowMs: number,
  maxDistanceMeters: number
): WazeAlert[] {
  if (!driverPosition) return [];
  return manualReports
    .filter(
      (report): report is ManualReport & { position: NonNullable<ManualReport['position']> } =>
        Boolean(report.position)
    )
    .filter((report) => nowMs - report.createdAtMs <= LIVE_REPORT_MAX_AGE_MS)
    .filter((report) => haversineDistance(driverPosition, report.position) <= maxDistanceMeters)
    .map(manualReportToWazeAlert);
}
