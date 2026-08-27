import type { NearbyReport } from '../useTripStore';
import { nearbyReportToWazeAlert, visibleNearbyReportAlerts } from '../nearbyReportAlert';

const DRIVER_POSITION = { latitude: -34.9, longitude: 138.6 };
const NOW_MS = 1_000_000_000_000;

function makeReport(overrides: Partial<NearbyReport> = {}): NearbyReport {
  return {
    id: 'remote-1',
    category: 'POLICE',
    subtype: null,
    position: DRIVER_POSITION,
    headingDeg: null,
    createdAtMs: NOW_MS,
    lastConfirmedAtMs: NOW_MS,
    confirmedByThisDevice: false,
    ...overrides,
  };
}

describe('nearbyReportToWazeAlert', () => {
  it('uses the report\'s real id as alert_id (no local-id-swap dance)', () => {
    const alert = nearbyReportToWazeAlert(makeReport({ id: 'remote-real-id' }));

    expect(alert.alert_id).toBe('remote-real-id');
  });

  it('carries the report\'s category and subtype through', () => {
    const alert = nearbyReportToWazeAlert(makeReport({ category: 'HAZARD', subtype: null }));

    expect(alert.type).toBe('HAZARD');
  });

  it('carries a POLICE report\'s subtype through', () => {
    const alert = nearbyReportToWazeAlert(makeReport({ category: 'POLICE', subtype: 'POLICE_VISIBLE' }));

    expect(alert.subtype).toBe('POLICE_VISIBLE');
  });
});

describe('visibleNearbyReportAlerts', () => {
  it('returns nothing when the driver position is not yet known', () => {
    expect(visibleNearbyReportAlerts([makeReport()], null, NOW_MS, 5000)).toEqual([]);
  });

  it('includes a fresh, nearby report', () => {
    const alerts = visibleNearbyReportAlerts([makeReport()], DRIVER_POSITION, NOW_MS, 5000);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert_id).toBe('remote-1');
  });

  it('excludes a report not confirmed within the live-report window', () => {
    const stale = makeReport({ lastConfirmedAtMs: NOW_MS - 30 * 60 * 1000 });

    expect(visibleNearbyReportAlerts([stale], DRIVER_POSITION, NOW_MS, 5000)).toEqual([]);
  });

  it('includes a report right at the confirmation-window boundary', () => {
    const twentyFourMinutesSinceConfirmed = makeReport({ lastConfirmedAtMs: NOW_MS - 24 * 60 * 1000 });

    expect(visibleNearbyReportAlerts([twentyFourMinutesSinceConfirmed], DRIVER_POSITION, NOW_MS, 5000)).toHaveLength(1);
  });

  it('excludes a report outside maxDistanceMeters of the driver', () => {
    const farAway = makeReport({ position: { latitude: DRIVER_POSITION.latitude + 1, longitude: DRIVER_POSITION.longitude } });

    expect(visibleNearbyReportAlerts([farAway], DRIVER_POSITION, NOW_MS, 5000)).toEqual([]);
  });

  it('includes a report within maxDistanceMeters of the driver', () => {
    const nearby = makeReport({ position: { latitude: DRIVER_POSITION.latitude + 0.009, longitude: DRIVER_POSITION.longitude } });

    expect(visibleNearbyReportAlerts([nearby], DRIVER_POSITION, NOW_MS, 5000)).toHaveLength(1);
  });
});
