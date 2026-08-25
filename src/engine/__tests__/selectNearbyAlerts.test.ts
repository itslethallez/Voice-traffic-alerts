import { buildMockAlerts, MOCK_DRIVER } from '../../api/waze/__mocks__/alerts.fixture';
import type { GeoPoint } from '../../geo/types';
import { selectNearbyAlerts } from '../selectNearbyAlerts';

const position: GeoPoint = { latitude: MOCK_DRIVER.latitude, longitude: MOCK_DRIVER.longitude };
const alerts = buildMockAlerts();

describe('selectNearbyAlerts', () => {
  it('returns the 3 closest ahead-of-travel alerts by default, nearest first', () => {
    const result = selectNearbyAlerts(alerts, position, MOCK_DRIVER.heading);
    expect(result.map((r) => r.alert.alert_id)).toEqual(['wm-006', 'wm-020', 'wm-012']);
    expect(result[0].distanceMeters).toBeLessThan(result[1].distanceMeters);
    expect(result[1].distanceMeters).toBeLessThan(result[2].distanceMeters);
  });

  it('excludes an alert directly behind the driver (180 degrees)', () => {
    const result = selectNearbyAlerts(alerts, position, MOCK_DRIVER.heading, alerts.length);
    expect(result.map((r) => r.alert.alert_id)).not.toContain('wm-008');
  });

  it('includes an alert directly to the side (90 degrees) - a wider tolerance than the announce window', () => {
    const result = selectNearbyAlerts(alerts, position, MOCK_DRIVER.heading, alerts.length);
    expect(result.map((r) => r.alert.alert_id)).toContain('wm-007');
  });

  it('respects a custom count', () => {
    const result = selectNearbyAlerts(alerts, position, MOCK_DRIVER.heading, 5);
    expect(result).toHaveLength(5);
  });

  it('sorts the full ahead-of-travel set nearest-first', () => {
    const result = selectNearbyAlerts(alerts, position, MOCK_DRIVER.heading, alerts.length);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].distanceMeters).toBeGreaterThanOrEqual(result[i - 1].distanceMeters);
    }
  });

  it('returns an empty array when no alerts are given', () => {
    expect(selectNearbyAlerts([], position, MOCK_DRIVER.heading)).toEqual([]);
  });
});
