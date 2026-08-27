import type { WazeAlert } from '../api/waze/types';
import type { ManualReport } from './useTripStore';

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
 */
export function manualReportToWazeAlert(report: ManualReport & { position: NonNullable<ManualReport['position']> }): WazeAlert {
  return {
    alert_id: report.id,
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
