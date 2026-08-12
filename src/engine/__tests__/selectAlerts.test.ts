import { buildMockAlerts, MOCK_DRIVER } from '../../api/waze/__mocks__/alerts.fixture';
import { selectAnnounceableAlerts } from '../selectAlerts';
import type { DriverState } from '../types';

/**
 * Expected outcomes below were derived by running the real geo functions
 * against the fixture (which places each alert with the exact same
 * great-circle math the engine measures it back with - see the fixture's
 * header comment), not by trusting the fixture's nominal distance/bearing
 * labels blind.
 */
const QUALIFYING_IDS = [
  'wm-001',
  'wm-002',
  'wm-003',
  'wm-004',
  'wm-010',
  'wm-011',
  'wm-012',
  'wm-013',
  'wm-015',
  'wm-016',
  'wm-018',
  'wm-019',
];

const EXCLUDED_IDS = ['wm-005', 'wm-006', 'wm-007', 'wm-008', 'wm-009', 'wm-014', 'wm-017', 'wm-020'];

describe('selectAnnounceableAlerts', () => {
  const now = Date.now();
  const alerts = buildMockAlerts(now);
  const driver: DriverState = {
    position: { latitude: MOCK_DRIVER.latitude, longitude: MOCK_DRIVER.longitude },
    headingDeg: MOCK_DRIVER.heading,
    speedKmh: 60,
  };

  it('selects exactly the alerts that pass distance, bearing and staleness', () => {
    const result = selectAnnounceableAlerts(alerts, driver, new Set(), now);
    const ids = result.map((r) => r.alert.alert_id).sort();
    expect(ids).toEqual([...QUALIFYING_IDS].sort());
  });

  it('excludes alerts too close, too far, to the side, behind, or stale', () => {
    const result = selectAnnounceableAlerts(alerts, driver, new Set(), now);
    const ids = new Set(result.map((r) => r.alert.alert_id));
    for (const excludedId of EXCLUDED_IDS) {
      expect(ids.has(excludedId)).toBe(false);
    }
  });

  it('includes alerts just inside the 300m/2000m/45deg boundaries', () => {
    // The exact boundary values (300, 2000, 45) are pinned directly in
    // geo/__tests__/announceWindow.test.ts against the predicates, with
    // no geo round-trip involved. Placing a fixture alert at an exact
    // boundary is floating-point-fragile (destinationPoint -> haversine
    // is not bit-exact), so this fixture uses "just inside" instead.
    const result = selectAnnounceableAlerts(alerts, driver, new Set(), now);
    const ids = new Set(result.map((r) => r.alert.alert_id));
    expect(ids.has('wm-012')).toBe(true); // 301m
    expect(ids.has('wm-011')).toBe(true); // 1999m
    expect(ids.has('wm-015')).toBe(true); // 44.5 degrees
  });

  it('excludes an alert just past a boundary: 46deg bearing, 31min old', () => {
    const result = selectAnnounceableAlerts(alerts, driver, new Set(), now);
    const ids = new Set(result.map((r) => r.alert.alert_id));
    expect(ids.has('wm-014')).toBe(false); // 46 degrees
    expect(ids.has('wm-017')).toBe(false); // 31 minutes old
  });

  it('dedupes on alert id already announced this trip', () => {
    const alreadyAnnounced = new Set(['wm-001', 'wm-002']);
    const result = selectAnnounceableAlerts(alerts, driver, alreadyAnnounced, now);
    const ids = result.map((r) => r.alert.alert_id);
    expect(ids).not.toContain('wm-001');
    expect(ids).not.toContain('wm-002');
  });

  it('sorts qualifying alerts by severity, then by ascending distance within a severity', () => {
    const result = selectAnnounceableAlerts(alerts, driver, new Set(), now);
    const ids = result.map((r) => r.alert.alert_id);

    // ACCIDENT (wm-012 @300, wm-002 @1400), ROAD_CLOSED (wm-019 @1700, wm-004 @1900),
    // HAZARD (wm-003 @500, wm-018 @600, wm-013 @1100), POLICE (wm-001 @800, wm-016 @900, wm-011 @2000),
    // JAM (wm-010 @700, wm-015 @1300).
    expect(ids).toEqual([
      'wm-012',
      'wm-002',
      'wm-019',
      'wm-004',
      'wm-003',
      'wm-018',
      'wm-013',
      'wm-001',
      'wm-016',
      'wm-011',
      'wm-010',
      'wm-015',
    ]);
  });

  it('respects a Settings-provided category filter', () => {
    const result = selectAnnounceableAlerts(alerts, driver, new Set(), now, {
      enabledTypes: new Set(['HAZARD']),
      maxDistanceMeters: 2000,
    });
    const types = new Set(result.map((r) => r.alert.type));
    expect(types).toEqual(new Set(['HAZARD']));
    expect(result.map((r) => r.alert.alert_id).sort()).toEqual(['wm-003', 'wm-013', 'wm-018']);
  });

  it('respects a Settings-provided announcement distance (narrower than the 2000m default)', () => {
    const result = selectAnnounceableAlerts(alerts, driver, new Set(), now, {
      maxDistanceMeters: 1000,
    });
    const ids = result.map((r) => r.alert.alert_id).sort();
    expect(ids).toEqual(['wm-001', 'wm-003', 'wm-010', 'wm-012', 'wm-016', 'wm-018'].sort());
    for (const r of result) {
      expect(r.distanceMeters).toBeLessThanOrEqual(1000);
    }
  });

  it('respects a Settings-provided announcement distance wider than the 2000m default', () => {
    const result = selectAnnounceableAlerts(alerts, driver, new Set(), now, {
      maxDistanceMeters: 3000,
    });
    const ids = new Set(result.map((r) => r.alert.alert_id));
    expect(ids.has('wm-005')).toBe(true); // 2996.63m, excluded by the 2000m default, included at 3000m
  });
});
