import type { ManualReport } from '../useTripStore';
import { manualReportToWazeAlert, visibleManualReportAlerts } from '../manualReportAlert';

const DRIVER_POSITION = { latitude: -34.9, longitude: 138.6 };
const NOW_MS = 1_000_000_000_000;

function makeReport(overrides: Partial<ManualReport> = {}): ManualReport {
  return {
    id: 'manual-1',
    localKey: 'manual-1',
    createdAtMs: NOW_MS,
    position: DRIVER_POSITION,
    headingDeg: null,
    ...overrides,
  };
}

describe('manualReportToWazeAlert', () => {
  it('uses localKey, not id, as alert_id', () => {
    const report = makeReport({ id: 'remote-real-id', localKey: 'manual-1' });

    const alert = manualReportToWazeAlert(report as ManualReport & { position: NonNullable<ManualReport['position']> });

    expect(alert.alert_id).toBe('manual-1');
  });
});

describe('visibleManualReportAlerts', () => {
  it('returns nothing when the driver position is not yet known', () => {
    expect(visibleManualReportAlerts([makeReport()], null, NOW_MS, 5000)).toEqual([]);
  });

  it('excludes a report with no position', () => {
    const report = makeReport({ position: null });

    expect(visibleManualReportAlerts([report], DRIVER_POSITION, NOW_MS, 5000)).toEqual([]);
  });

  it('includes a fresh, nearby report', () => {
    const report = makeReport();

    const alerts = visibleManualReportAlerts([report], DRIVER_POSITION, NOW_MS, 5000);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert_id).toBe('manual-1');
  });

  it('excludes a report older than the live-report age cutoff', () => {
    // Regression test (Bugbot: "Stale reports shown as live alerts") - a
    // report from an earlier trip shouldn't resurface as a current hazard.
    const twoHoursAgo = makeReport({ createdAtMs: NOW_MS - 2 * 60 * 60 * 1000 });

    expect(visibleManualReportAlerts([twoHoursAgo], DRIVER_POSITION, NOW_MS, 5000)).toEqual([]);
  });

  it('includes a report right at the age cutoff boundary', () => {
    const fiftyNineMinutesAgo = makeReport({ createdAtMs: NOW_MS - 59 * 60 * 1000 });

    expect(visibleManualReportAlerts([fiftyNineMinutesAgo], DRIVER_POSITION, NOW_MS, 5000)).toHaveLength(1);
  });

  it('excludes a report outside maxDistanceMeters of the driver', () => {
    // Regression test (Bugbot: "Stale reports shown as live alerts") - a
    // report from a different trip, in a different place, shouldn't show
    // up as a hazard near the driver's current location.
    const farAway = makeReport({ position: { latitude: DRIVER_POSITION.latitude + 1, longitude: DRIVER_POSITION.longitude } });

    expect(visibleManualReportAlerts([farAway], DRIVER_POSITION, NOW_MS, 5000)).toEqual([]);
  });

  it('includes a report within maxDistanceMeters of the driver', () => {
    // ~0.009 degrees latitude is roughly 1km, well inside a 5km radius.
    const nearby = makeReport({ position: { latitude: DRIVER_POSITION.latitude + 0.009, longitude: DRIVER_POSITION.longitude } });

    expect(visibleManualReportAlerts([nearby], DRIVER_POSITION, NOW_MS, 5000)).toHaveLength(1);
  });
});
