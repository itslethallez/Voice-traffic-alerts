import type { WazeAlert } from '../../api/waze/types';
import type { FixedSpeedCamera } from '../../data/fixedSpeedCameras';
import { destinationPoint } from '../../geo/destination';
import type { DriverState } from '../types';
import {
  hasNearbyWarningTarget,
  selectSpeedCameraWarning,
  SPEED_WARNING_BUFFER_KMH,
  type SpeedWarningCheckpoint,
} from '../selectSpeedCameraWarning';

const DRIVER_POSITION = { latitude: -34.9, longitude: 138.6 };
const NOW_MS = Date.parse('2026-01-01T12:00:00.000Z');

function makeDriver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    position: DRIVER_POSITION,
    headingDeg: 0,
    speedKmh: 0,
    ...overrides,
  };
}

/** Places a point `distanceMeters` due north of the driver (bearing 0,
 * matching the driver's default north heading - well within the 45-degree
 * cone). */
function pointAhead(distanceMeters: number) {
  return destinationPoint(DRIVER_POSITION, distanceMeters, 0);
}

function makeCamera(distanceMeters: number, overrides: Partial<FixedSpeedCamera> = {}): FixedSpeedCamera {
  return {
    id: 'sapol-test',
    label: 'Test St, TESTVILLE',
    position: pointAhead(distanceMeters),
    ...overrides,
  };
}

function makeReport(
  distanceMeters: number,
  overrides: Partial<WazeAlert> & { ageMinutes?: number } = {}
): WazeAlert {
  const { ageMinutes = 5, ...alertOverrides } = overrides;
  const position = pointAhead(distanceMeters);
  return {
    alert_id: 'report-test',
    type: 'POLICE',
    subtype: null,
    reported_by: null,
    description: null,
    image: null,
    publish_datetime_utc: new Date(NOW_MS - ageMinutes * 60_000).toISOString(),
    country: 'AU',
    city: 'Adelaide',
    street: 'Test St',
    latitude: position.latitude,
    longitude: position.longitude,
    num_thumbs_up: 0,
    alert_reliability: 0,
    alert_confidence: 0,
    near_by: null,
    comments: [],
    num_comments: 0,
    ...alertOverrides,
  };
}

const NO_FIRED_CHECKPOINTS = new Map<string, ReadonlySet<SpeedWarningCheckpoint>>();

describe('SPEED_WARNING_BUFFER_KMH', () => {
  it('is the confirmed 6 km/h buffer', () => {
    expect(SPEED_WARNING_BUFFER_KMH).toBe(6);
  });
});

describe('selectSpeedCameraWarning - speeding buffer', () => {
  it('does not fire when at the posted limit', () => {
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 60 }),
      speedLimitKmh: 60,
      cameras: [makeCamera(400)],
      alerts: [],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    expect(result).toBeNull();
  });

  it('does not fire when under the buffer (5 km/h over a 60 limit)', () => {
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 65 }),
      speedLimitKmh: 60,
      cameras: [makeCamera(400)],
      alerts: [],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    expect(result).toBeNull();
  });

  it('fires at exactly the buffer (66 in a 60 zone)', () => {
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 66 }),
      speedLimitKmh: 60,
      cameras: [makeCamera(400)],
      alerts: [],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    expect(result).not.toBeNull();
  });

  it('never fires when the speed limit is unresolved (null)', () => {
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 120 }),
      speedLimitKmh: null,
      cameras: [makeCamera(400)],
      alerts: [],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    expect(result).toBeNull();
  });
});

describe('selectSpeedCameraWarning - checkpoints', () => {
  it('fires the 500m checkpoint when within 500m but not yet 200m', () => {
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [makeCamera(450)],
      alerts: [],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    expect(result?.checkpoint).toBe(500);
  });

  it('fires the 200m checkpoint once inside 200m, given 500 already fired', () => {
    const fired = new Map<string, ReadonlySet<SpeedWarningCheckpoint>>([['sapol-test', new Set([500])]]);
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [makeCamera(150)],
      alerts: [],
      firedCheckpoints: fired,
      nowMs: NOW_MS,
    });
    expect(result?.checkpoint).toBe(200);
  });

  it('does not fire beyond 500m even while speeding', () => {
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [makeCamera(600)],
      alerts: [],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    expect(result).toBeNull();
  });

  it('fires inside 200m even though that is under announceWindow.ts\'s 300m floor for other alerts', () => {
    const fired = new Map<string, ReadonlySet<SpeedWarningCheckpoint>>([['sapol-test', new Set([500])]]);
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [makeCamera(100)],
      alerts: [],
      firedCheckpoints: fired,
      nowMs: NOW_MS,
    });
    expect(result?.checkpoint).toBe(200);
  });

  it('does not refire a checkpoint already recorded for that target', () => {
    const fired = new Map<string, ReadonlySet<SpeedWarningCheckpoint>>([['sapol-test', new Set([500])]]);
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [makeCamera(450)],
      alerts: [],
      firedCheckpoints: fired,
      nowMs: NOW_MS,
    });
    expect(result).toBeNull();
  });

  it('fires 200 after 500 has already fired for the same target', () => {
    const fired = new Map<string, ReadonlySet<SpeedWarningCheckpoint>>([['sapol-test', new Set([500])]]);
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [makeCamera(150)],
      alerts: [],
      firedCheckpoints: fired,
      nowMs: NOW_MS,
    });
    expect(result?.checkpoint).toBe(200);
  });

  it('when both checkpoints are unfired and the driver has already jumped inside 200m, fires 500 first (farthest-first rule)', () => {
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [makeCamera(150)],
      alerts: [],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    // 150m qualifies for both 500 and 200; farthest-first means 500 wins here.
    expect(result?.checkpoint).toBe(500);
  });
});

describe('selectSpeedCameraWarning - corroboration', () => {
  it('fires for a report with a thumbs-up but reliability 0', () => {
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [],
      alerts: [makeReport(400, { num_thumbs_up: 1, alert_reliability: 0 })],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    expect(result).not.toBeNull();
  });

  it('fires for a report with reliability >= 4 but zero thumbs-up', () => {
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [],
      alerts: [makeReport(400, { num_thumbs_up: 0, alert_reliability: 4 })],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    expect(result).not.toBeNull();
  });

  it('does not fire for an uncorroborated report (0 thumbs-up, reliability < 4)', () => {
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [],
      alerts: [makeReport(400, { num_thumbs_up: 0, alert_reliability: 3 })],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    expect(result).toBeNull();
  });

  it('ignores a corroborated report of a non-POLICE type', () => {
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [],
      alerts: [makeReport(400, { type: 'HAZARD', num_thumbs_up: 5, alert_reliability: 9 })],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    expect(result).toBeNull();
  });

  it('ignores a corroborated report older than the 30-minute announce freshness window', () => {
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [],
      alerts: [makeReport(400, { num_thumbs_up: 5, ageMinutes: 45 })],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    expect(result).toBeNull();
  });
});

describe('selectSpeedCameraWarning - geometry', () => {
  it('ignores a target behind the driver (outside the 45-degree cone)', () => {
    const behind = destinationPoint(DRIVER_POSITION, 150, 180);
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [makeCamera(0, { position: behind })],
      alerts: [],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    expect(result).toBeNull();
  });

  it('when multiple targets qualify, the nearest one wins', () => {
    const result = selectSpeedCameraWarning({
      driver: makeDriver({ speedKmh: 100 }),
      speedLimitKmh: 60,
      cameras: [makeCamera(480, { id: 'far' }), makeCamera(180, { id: 'near' })],
      alerts: [],
      firedCheckpoints: NO_FIRED_CHECKPOINTS,
      nowMs: NOW_MS,
    });
    expect(result?.target.id).toBe('near');
  });
});

describe('hasNearbyWarningTarget', () => {
  it('is true when a camera is within range, without needing a speed limit', () => {
    expect(
      hasNearbyWarningTarget(makeDriver(), [makeCamera(300)], [], NOW_MS)
    ).toBe(true);
  });

  it('is false when nothing is nearby', () => {
    expect(hasNearbyWarningTarget(makeDriver(), [makeCamera(900)], [], NOW_MS)).toBe(false);
  });

  it('is true for a nearby corroborated report even with no cameras at all', () => {
    expect(
      hasNearbyWarningTarget(makeDriver(), [], [makeReport(300, { num_thumbs_up: 1 })], NOW_MS)
    ).toBe(true);
  });

  it('is false for a nearby but uncorroborated report', () => {
    expect(
      hasNearbyWarningTarget(makeDriver(), [], [makeReport(300, { num_thumbs_up: 0, alert_reliability: 0 })], NOW_MS)
    ).toBe(false);
  });
});
