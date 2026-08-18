import { buildMockAlerts, MOCK_DRIVER } from '../../api/waze/__mocks__/alerts.fixture';
import type { WazeAlert } from '../../api/waze/types';
import { MAX_BRIEFING_ALERTS } from '../constants';
import { selectBriefingAlerts } from '../selectBriefingAlerts';
import type { GeoPoint } from '../../geo/types';

const position: GeoPoint = { latitude: MOCK_DRIVER.latitude, longitude: MOCK_DRIVER.longitude };

describe('selectBriefingAlerts', () => {
  const now = Date.now();
  const alerts = buildMockAlerts(now);

  it('is distance- and freshness-filtered only - no bearing/heading dependency', () => {
    // wm-005 (3000m) is excluded by the 2000m radius; wm-009 (40min) and
    // wm-017 (31min) are excluded by the 30-minute freshness cutoff.
    // Everything else qualifies regardless of bearing, including alerts
    // that live driving would exclude for being to the side or behind.
    const result = selectBriefingAlerts(alerts, position, now, { radiusMeters: 2000 });
    const ids = new Set(result.map((r) => r.alert.alert_id));

    expect(ids.has('wm-005')).toBe(false); // too far
    expect(ids.has('wm-009')).toBe(false); // stale (40min)
    expect(ids.has('wm-017')).toBe(false); // stale (31min)
  });

  it('does not apply a minimum-distance floor - unlike live driving, close alerts qualify', () => {
    // wm-006 (150m) and wm-020 (250m) are inside live driving's 300m
    // floor and would never qualify there, but the briefing has no such
    // floor - a stationary driver wants to know what's right next to them.
    const result = selectBriefingAlerts(alerts, position, now, { radiusMeters: 2000 });
    const ids = new Set(result.map((r) => r.alert.alert_id));
    expect(ids.has('wm-006')).toBe(true);
    expect(ids.has('wm-020')).toBe(true);
  });

  it('ignores bearing entirely - an alert directly behind the driver still qualifies', () => {
    // wm-008 is a HAZARD 1200m directly behind the driver (180 degrees) -
    // selectAnnounceableAlerts would exclude it; the briefing should not.
    const result = selectBriefingAlerts(alerts, position, now, {
      radiusMeters: 2000,
      enabledTypes: new Set(['HAZARD']),
    });
    const ids = result.map((r) => r.alert.alert_id);
    expect(ids).toContain('wm-008');
  });

  it('respects an enabled-category filter', () => {
    const result = selectBriefingAlerts(alerts, position, now, {
      radiusMeters: 2000,
      enabledTypes: new Set(['JAM']),
    });
    const types = new Set(result.map((r) => r.alert.type));
    expect(types).toEqual(new Set(['JAM']));
  });

  it('respects the configured briefing radius', () => {
    const narrow = selectBriefingAlerts(alerts, position, now, { radiusMeters: 400 });
    for (const r of narrow) {
      expect(r.distanceMeters).toBeLessThanOrEqual(400);
    }
    expect(narrow.map((r) => r.alert.alert_id)).toEqual(
      expect.arrayContaining(['wm-006', 'wm-012', 'wm-020'])
    );
  });

  it('sorts nearest-first, not by severity', () => {
    const result = selectBriefingAlerts(alerts, position, now, { radiusMeters: 2000 });
    for (let i = 1; i < result.length; i++) {
      expect(result[i].distanceMeters).toBeGreaterThanOrEqual(result[i - 1].distanceMeters);
    }
    // wm-006 (POLICE, 150m) sorts before wm-012 (ACCIDENT, 301m) - severity
    // (which ranks ACCIDENT above POLICE) would order these the other way.
    const ids = result.map((r) => r.alert.alert_id);
    expect(ids.indexOf('wm-006')).toBeLessThan(ids.indexOf('wm-012'));
  });

  it('caps the result at MAX_BRIEFING_ALERTS', () => {
    const result = selectBriefingAlerts(alerts, position, now, { radiusMeters: 2000 });
    expect(result.length).toBe(MAX_BRIEFING_ALERTS);
  });

  it('breaks distance ties deterministically by alert_id', () => {
    const base = alerts[0];
    const makeAlertAt = (id: string): WazeAlert => ({
      ...base,
      alert_id: id,
      latitude: base.latitude,
      longitude: base.longitude,
    });
    const tied = [makeAlertAt('b-alert'), makeAlertAt('a-alert'), makeAlertAt('c-alert')];

    const result = selectBriefingAlerts(tied, position, now, { radiusMeters: 50_000 });
    expect(result.map((r) => r.alert.alert_id)).toEqual(['a-alert', 'b-alert', 'c-alert']);
  });

  it('returns nothing when every candidate is filtered out', () => {
    const result = selectBriefingAlerts(alerts, position, now, {
      radiusMeters: 2000,
      enabledTypes: new Set([]),
    });
    expect(result).toEqual([]);
  });
});
