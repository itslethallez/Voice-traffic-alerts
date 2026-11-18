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
    category: 'POLICE',
    subtype: null,
    lastConfirmedAtMs: NOW_MS,
    corroborationCount: 0,
    ...overrides,
  };
}

describe('manualReportToWazeAlert', () => {
  it('uses localKey, not id, as alert_id', () => {
    const report = makeReport({ id: 'remote-real-id', localKey: 'manual-1' });

    const alert = manualReportToWazeAlert(report as ManualReport & { position: NonNullable<ManualReport['position']> });

    expect(alert.alert_id).toBe('manual-1');
  });

  it('carries the report\'s own category and subtype through, not a hardcoded POLICE', () => {
    const report = makeReport({ category: 'HAZARD', subtype: null });

    const alert = manualReportToWazeAlert(report as ManualReport & { position: NonNullable<ManualReport['position']> });

    expect(alert.type).toBe('HAZARD');
  });

  it('carries a POLICE report\'s subtype through', () => {
    const report = makeReport({ category: 'POLICE', subtype: 'POLICE_VISIBLE' });

    const alert = manualReportToWazeAlert(report as ManualReport & { position: NonNullable<ManualReport['position']> });

    expect(alert.subtype).toBe('POLICE_VISIBLE');
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

  it('excludes a report not confirmed within the live-report window', () => {
    // Regression test (Bugbot: "Stale reports shown as live alerts") - a
    // report from an earlier trip shouldn't resurface as a current hazard.
    const overThirtyMinutesSinceConfirmed = makeReport({ lastConfirmedAtMs: NOW_MS - 30 * 60 * 1000 });

    expect(visibleManualReportAlerts([overThirtyMinutesSinceConfirmed], DRIVER_POSITION, NOW_MS, 5000)).toEqual([]);
  });

  it('includes a report right at the confirmation-window boundary', () => {
    const twentyFourMinutesSinceConfirmed = makeReport({ lastConfirmedAtMs: NOW_MS - 24 * 60 * 1000 });

    expect(visibleManualReportAlerts([twentyFourMinutesSinceConfirmed], DRIVER_POSITION, NOW_MS, 5000)).toHaveLength(1);
  });

  it('stays visible past the base window when confirmed more recently than it was created', () => {
    // A confirmation resets the window from the moment it happens, not just
    // extends the original creation time - a report created 2 hours ago but
    // confirmed 5 minutes ago is still live.
    const confirmedRecently = makeReport({
      createdAtMs: NOW_MS - 2 * 60 * 60 * 1000,
      lastConfirmedAtMs: NOW_MS - 5 * 60 * 1000,
    });

    expect(visibleManualReportAlerts([confirmedRecently], DRIVER_POSITION, NOW_MS, 5000)).toHaveLength(1);
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
