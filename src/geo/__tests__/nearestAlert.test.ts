import { destinationPoint } from '../destination';
import { nearestAlertToDriver } from '../nearestAlert';
import type { GeoPoint } from '../types';

const DRIVER: GeoPoint = { latitude: -34.9, longitude: 138.6 };

const alertAt = (id: string, distanceMeters: number, bearingDeg: number) => {
  const position = destinationPoint(DRIVER, distanceMeters, bearingDeg);
  return { alert_id: id, latitude: position.latitude, longitude: position.longitude };
};

describe('nearestAlertToDriver', () => {
  it('returns null without a driver position or alerts', () => {
    expect(nearestAlertToDriver([], DRIVER)).toBeNull();
    expect(nearestAlertToDriver([alertAt('a', 500, 0)], null)).toBeNull();
  });

  it('selects the closest visible alert regardless of its category or bearing', () => {
    const farBehind = alertAt('police', 2200, 180);
    const nearSideRoad = alertAt('hazard', 600, 90);
    const result = nearestAlertToDriver([farBehind, nearSideRoad], DRIVER);

    expect(result?.alert_id).toBe('hazard');
  });
});
