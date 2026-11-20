import type { WazeAlert } from '../../api/waze/types';
import { destinationPoint } from '../../geo/destination';
import { selectApproachingAlerts } from '../selectApproachingAlerts';
import type { DriverState } from '../types';

const NOW = Date.parse('2026-11-20T00:00:00Z');
const ORIGIN = { latitude: -34.9, longitude: 138.6 };
const driver: DriverState = { position: ORIGIN, headingDeg: 0, speedKmh: 72 };
const settings = { maxDistanceMeters: 5000 };

function alertAt(id: string, distanceMeters: number, bearingDeg = 0, ageMinutes = 2): WazeAlert {
  const p = destinationPoint(ORIGIN, distanceMeters, bearingDeg);
  return {
    alert_id: id,
    type: 'HAZARD',
    subtype: null,
    reported_by: null,
    description: null,
    image: null,
    publish_datetime_utc: new Date(NOW - ageMinutes * 60_000).toISOString(),
    country: 'AU',
    city: 'Adelaide',
    street: `${id} Rd`,
    latitude: p.latitude,
    longitude: p.longitude,
    num_thumbs_up: 0,
    alert_reliability: 5,
    alert_confidence: 3,
    near_by: null,
    comments: [],
    num_comments: 0,
  } as WazeAlert;
}

const ids = (xs: { candidate: { alert: WazeAlert } }[]) => xs.map((x) => x.candidate.alert.alert_id).sort();

describe('selectApproachingAlerts', () => {
  it('finds an alert just outside the warn radius, entering at the radius', () => {
    const result = selectApproachingAlerts([alertAt('out', 5400)], driver, new Map(), NOW, settings, 900);
    expect(ids(result)).toEqual(['out']);
    expect(result[0].entryDistanceMeters).toBe(5000);
  });

  it('excludes alerts already inside the radius (the queue covers those) and beyond the lookahead', () => {
    const alerts = [alertAt('inside', 3000), alertAt('out', 5400), alertAt('far', 7000)];
    expect(ids(selectApproachingAlerts(alerts, driver, new Map(), NOW, settings, 900))).toEqual(['out']);
  });

  it('applies the same heading cone as announcing does', () => {
    const behind = alertAt('behind', 5400, 180);
    expect(selectApproachingAlerts([behind], driver, new Map(), NOW, settings, 900)).toEqual([]);
  });

  it('finds an announced alert approaching its 1km-closer reminder threshold', () => {
    // Announced at 4500m, now at 3700m: reminder fires at 3500m.
    const result = selectApproachingAlerts(
      [alertAt('seen', 3700)],
      driver,
      new Map([['seen', 4500]]),
      NOW,
      settings,
      900
    );
    expect(ids(result)).toEqual(['seen']);
    expect(result[0].entryDistanceMeters).toBe(3500);
  });

  it('does not treat an announced alert as approaching while its reminder is still far off', () => {
    const result = selectApproachingAlerts([alertAt('seen', 4300)], driver, new Map([['seen', 4500]]), NOW, settings, 300);
    expect(result).toEqual([]);
  });

  it('returns nothing with no lookahead (stationary driver)', () => {
    expect(selectApproachingAlerts([alertAt('out', 5100)], driver, new Map(), NOW, settings, 0)).toEqual([]);
  });
});
