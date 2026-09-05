import type { WazeAlert } from '../../api/waze/types';
import { destinationPoint } from '../../geo/destination';
import type { GeoPoint } from '../../geo/types';
import { selectClosestOnPathAlert } from '../selectClosestOnPathAlert';

const DRIVER_POSITION: GeoPoint = { latitude: -34.9, longitude: 138.6 };
const DRIVER_HEADING_DEG = 0; // due north

let nextId = 0;

function makeAlertAt(distanceMeters: number, bearingFromDriverDeg: number, overrides: Partial<WazeAlert> = {}): WazeAlert {
  nextId += 1;
  const position = destinationPoint(DRIVER_POSITION, distanceMeters, bearingFromDriverDeg);
  return {
    alert_id: `closest-test-${nextId}`,
    type: 'POLICE',
    subtype: null,
    reported_by: null,
    description: null,
    image: null,
    publish_datetime_utc: new Date().toISOString(),
    country: 'AU',
    city: '',
    street: null,
    latitude: position.latitude,
    longitude: position.longitude,
    num_thumbs_up: 0,
    alert_reliability: 5,
    alert_confidence: 1,
    near_by: null,
    comments: [],
    num_comments: 0,
    ...overrides,
  };
}

describe('selectClosestOnPathAlert', () => {
  it('returns null when there are no alerts', () => {
    expect(selectClosestOnPathAlert([], DRIVER_POSITION, DRIVER_HEADING_DEG, 2000)).toBeNull();
  });

  it('picks the nearest of several alerts within the distance window', () => {
    const near = makeAlertAt(500, 0);
    const far = makeAlertAt(1500, 0);
    const result = selectClosestOnPathAlert([far, near], DRIVER_POSITION, DRIVER_HEADING_DEG, 2000);
    expect(result?.alert.alert_id).toBe(near.alert_id);
    expect(result?.distanceMeters).toBeCloseTo(500, 0);
  });

  it('excludes an alert closer than the announce-window floor (300m)', () => {
    const tooClose = makeAlertAt(100, 0);
    expect(selectClosestOnPathAlert([tooClose], DRIVER_POSITION, DRIVER_HEADING_DEG, 2000)).toBeNull();
  });

  it('excludes an alert beyond maxDistanceMeters', () => {
    const tooFar = makeAlertAt(2500, 0);
    expect(selectClosestOnPathAlert([tooFar], DRIVER_POSITION, DRIVER_HEADING_DEG, 2000)).toBeNull();
  });

  it('still returns the nearest alert even when it is off the driver\'s heading (bearing not gated here)', () => {
    const behind = makeAlertAt(500, 180); // directly behind the driver
    const result = selectClosestOnPathAlert([behind], DRIVER_POSITION, DRIVER_HEADING_DEG, 2000);
    expect(result?.alert.alert_id).toBe(behind.alert_id);
    expect(result?.bearingDiffDeg).toBeCloseTo(180, 0);
  });

  it('reports bearingDiffDeg near 0 for an alert straight ahead', () => {
    const ahead = makeAlertAt(500, 0);
    const result = selectClosestOnPathAlert([ahead], DRIVER_POSITION, DRIVER_HEADING_DEG, 2000);
    expect(result?.bearingDiffDeg).toBeCloseTo(0, 0);
  });
});
