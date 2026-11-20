/**
 * The "what does Shotgun say" cases from the 20 Nov 2026 audit, as
 * fixtures. Each one runs the real pipeline the trip runtime uses -
 * selectAnnounceableAlerts (wide road-matching cone) -> roadContextFor
 * (road/roadContextRuntime.ts, with the Mapbox call replaced by a recorded
 * Directions-shaped response) -> applyRoadContext -> formatAnnouncement /
 * selectSpeedCameraWarning + formatSpeedCameraWarning - and pins the exact
 * sentence a driver hears (or that they hear nothing).
 *
 * Before road matching, every one of these said "... ahead" (or, for D,
 * nothing at all) - see the audit table in the Stage 3 PR.
 */
jest.mock('../../config/env', () => ({ env: { mapboxAccessToken: 'test-token' } }));
jest.mock('../../api/mapbox/reverseGeocode', () => ({ fetchSuburbForPoint: () => Promise.resolve(null) }));

import { parseForwardRoute } from '../../api/mapbox/forwardRoute';
import type { WazeAlert, WazeAlertType } from '../../api/waze/types';
import type { FixedSpeedCamera } from '../../data/fixedSpeedCameras';
import { alertDistanceFor } from '../../engine/alertDistance';
import { selectAnnounceableAlerts } from '../../engine/selectAlerts';
import { selectSpeedCameraWarning, type WarningTarget } from '../../engine/selectSpeedCameraWarning';
import type { DriverState } from '../../engine/types';
import { destinationPoint } from '../../geo/destination';
import type { GeoPoint } from '../../geo/types';
import { toDriverState } from '../../location/toDriverState';
import { formatAnnouncement } from '../../speech/formatAnnouncement';
import { formatSpeedCameraWarning } from '../../speech/formatSpeedCameraWarning';
import { applyRoadContext } from '../applyRoadContext';
import {
  BEHIND_BEARING_DEG,
  getRoadMatchingStats,
  resetRoadContext,
  roadContextFor,
  setForwardRouteFetcherForTests,
} from '../roadContextRuntime';

const NOW = Date.parse('2026-11-20T02:00:00.000Z');
/** On Main North Road, Elizabeth (SA), heading north. */
const START: GeoPoint = { latitude: -34.72, longitude: 138.67 };

type Step = [maneuverType: string, modifier: string | null, name: string, distanceMeters: number];

/** A Mapbox Directions (driving, steps=true, geometries=geojson) body. */
function directionsBody(from: GeoPoint, to: GeoPoint, steps: Step[], snapMeters = 3) {
  const distance = steps.reduce((sum, s) => sum + s[3], 0);
  return {
    code: 'Ok',
    routes: [
      {
        distance,
        geometry: { coordinates: [[from.longitude, from.latitude], [to.longitude, to.latitude]] as [number, number][] },
        legs: [
          {
            steps: [
              ...steps.map(([type, modifier, name, d]) => ({
                name,
                distance: d,
                maneuver: modifier ? { type, modifier } : { type },
              })),
              { name: steps[steps.length - 1][2], distance: 0, maneuver: { type: 'arrive' } },
            ],
          },
        ],
      },
    ],
    waypoints: [{ distance: 2 }, { distance: snapMeters }],
  };
}

let routeFor: (to: GeoPoint) => ReturnType<typeof directionsBody>;
let requests: Array<{ from: GeoPoint; headingDeg: number; to: GeoPoint }>;

beforeEach(() => {
  resetRoadContext();
  requests = [];
  setForwardRouteFetcherForTests(async (from, headingDeg, to) => {
    requests.push({ from, headingDeg, to });
    return parseForwardRoute(routeFor(to));
  });
});

afterAll(() => setForwardRouteFetcherForTests(null));

function alert(id: string, type: WazeAlertType, position: GeoPoint, street: string | null, city = 'Elizabeth'): WazeAlert {
  return {
    alert_id: id,
    type,
    subtype: null,
    reported_by: null,
    description: null,
    image: null,
    publish_datetime_utc: new Date(NOW - 3 * 60_000).toISOString(),
    country: 'AU',
    city,
    street,
    latitude: position.latitude,
    longitude: position.longitude,
    num_thumbs_up: 0,
    alert_reliability: 0,
    alert_confidence: 0,
    near_by: null,
    comments: [],
    num_comments: 0,
  };
}

function driverAt(position: GeoPoint, headingDeg: number, speedKmh = 80): DriverState {
  return { position, headingDeg, speedKmh, headingReliable: true };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/**
 * What the driver hears for these alerts on this fix - one pass, then a
 * second once the road lookup has landed (as the trip runtime would on
 * the next 3s fix). null = silent.
 */
async function spoken(alerts: WazeAlert[], driver: DriverState): Promise<string | null> {
  const radiusFor = alertDistanceFor('normal');
  const settings = { maxDistanceMeters: 5_000, maxDistanceForType: radiusFor, maxBearingDiffDeg: BEHIND_BEARING_DEG };
  const pass = () =>
    applyRoadContext(
      selectAnnounceableAlerts(alerts, driver, new Map(), NOW, settings),
      (target) => roadContextFor(target, driver, NOW),
      radiusFor,
      new Map()
    );
  pass();
  await flush();
  const out = pass();
  return out.length > 0 ? formatAnnouncement(out[0]) : null;
}

describe('road matching: audit cases A-F', () => {
  it('A. crash on a parallel road 1km to the side, 3km up -> nearby, straight-line, never "ahead"', async () => {
    const at = destinationPoint(destinationPoint(START, 3_000, 0), 1_000, 90);
    routeFor = (to) =>
      directionsBody(START, to, [
        ['depart', null, 'Main North Road', 2_400],
        ['turn', 'right', 'Womma Road', 1_000],
        ['turn', 'left', 'Parallel Road', 600],
      ]);
    expect(await spoken([alert('A', 'ACCIDENT', at, 'Parallel Rd')], driverAt(START, 0))).toBe(
      'Crash reported nearby on Parallel Road, Elizabeth, 3.2 kilometres away.'
    );
  });

  it('B. cross street 1.2km up, 700m off to the side -> nearby', async () => {
    const at = destinationPoint(destinationPoint(START, 1_200, 0), 700, 90);
    routeFor = (to) =>
      directionsBody(START, to, [
        ['depart', null, 'Main North Road', 1_200],
        ['turn', 'right', 'Side Street', 700],
      ]);
    expect(await spoken([alert('B', 'ACCIDENT', at, 'Side St')], driverAt(START, 0))).toBe(
      'Crash reported nearby on Side Street, Elizabeth, 1.4 kilometres away.'
    );
  });

  it('C. opposite carriageway of your own road (Mapbox needs a U-turn to reach it) -> silent', async () => {
    const at = destinationPoint(START, 2_000, 0);
    routeFor = (to) =>
      directionsBody(START, to, [
        ['depart', null, 'Main North Road', 2_300],
        ['continue', 'uturn', 'Main North Road', 300],
      ]);
    expect(await spoken([alert('C', 'ACCIDENT', at, 'A1 - Main North Rd')], driverAt(START, 0))).toBeNull();
  });

  it('C2. opposite carriageway, reached by looping round a block instead of a U-turn -> nearby, not "ahead"', async () => {
    const at = destinationPoint(START, 2_000, 0);
    routeFor = (to) =>
      directionsBody(START, to, [
        ['depart', null, 'Main North Road', 2_300],
        ['turn', 'right', 'Philip Highway', 150],
        ['turn', 'right', 'Elizabeth Way', 120],
        ['turn', 'right', 'Main North Road', 450],
      ]);
    expect(await spoken([alert('C2', 'ACCIDENT', at, 'A1 - Main North Rd')], driverAt(START, 0))).toBe(
      'Crash reported nearby on Main North Road, Elizabeth, 2 kilometres away.'
    );
  });

  it('D. your own road bends, so the crash is 50 degrees off your heading -> ahead, along-road distance (was silent)', async () => {
    const at = destinationPoint(START, 1_500, 50);
    routeFor = (to) => directionsBody(START, to, [['depart', null, 'Main North Road', 1_800]]);
    expect(await spoken([alert('D', 'ACCIDENT', at, 'A1 - Main North Rd')], driverAt(START, 0))).toBe(
      'Crash reported, 1.8 kilometres ahead on Main North Road.'
    );
  });

  it('D-control. the same crash straight ahead on your road -> ahead on it', async () => {
    const at = destinationPoint(START, 1_500, 0);
    routeFor = (to) => directionsBody(START, to, [['depart', null, 'Main North Road', 1_520]]);
    expect(await spoken([alert('D0', 'ACCIDENT', at, 'A1 - Main North Rd')], driverAt(START, 0))).toBe(
      'Crash reported, 1.5 kilometres ahead on Main North Road.'
    );
  });

  it('E. driving south, first fix has no heading (placeholder north), crash 1.5km behind -> never "ahead", then silent', async () => {
    const behind = destinationPoint(START, 1_500, 0);
    routeFor = () => {
      throw new Error('no lookup should be made off a placeholder heading');
    };
    const crash = alert('E', 'ACCIDENT', behind, 'Behind Rd');

    const first = toDriverState({ latitude: START.latitude, longitude: START.longitude, heading: null, speed: 22 }, null);
    expect(first.headingReliable).toBe(false);
    expect(await spoken([crash], first)).toBe('Crash reported nearby on Behind Road, Elizabeth, 1.5 kilometres away.');
    expect(requests).toHaveLength(0);

    // Next fix, 60m further south: a real heading (180) is derived, and the
    // crash is behind - silent.
    const southOfStart = destinationPoint(START, 60, 180);
    const second = toDriverState(
      { latitude: southOfStart.latitude, longitude: southOfStart.longitude, heading: null, speed: 22 },
      first
    );
    expect(second.headingReliable).toBe(true);
    expect(await spoken([crash], second)).toBeNull();
  });

  describe('F. fixed camera on a parallel street 150m away; driver doing 80 in a 60', () => {
    const cameraAt = destinationPoint(destinationPoint(START, 450, 0), 150, 90);
    const camera: FixedSpeedCamera = { id: 'sapol-F', label: 'Parallel Street, ELIZABETH', position: cameraAt };

    async function warning(driver: DriverState): Promise<string | null> {
      const roadFor = (target: WarningTarget) =>
        roadContextFor(
          { id: target.id, position: target.position, streets: target.streets, kind: 'fixedCamera' },
          driver,
          NOW
        );
      const select = () =>
        selectSpeedCameraWarning({
          driver,
          speedLimitKmh: 60, // looked up for the driver's road
          cameras: [camera],
          alerts: [],
          firedCheckpoints: new Map(),
          nowMs: NOW,
          roadFor,
        });
      select(); // starts the lookup (the trip runtime does this from 2km out)
      await flush();
      const result = select();
      return result
        ? formatSpeedCameraWarning(result.target.kind, result.checkpoint, result.confirmedSpeeding, result.road)
        : null;
    }

    it('-> "nearby", no "ahead", no speeding claim (the limit was for the wrong road)', async () => {
      routeFor = (to) =>
        directionsBody(START, to, [
          ['depart', null, 'Main North Road', 300],
          ['turn', 'right', 'Cross Street', 150],
          ['turn', 'left', 'Parallel Street', 150],
        ]);
      expect(await warning(driverAt(START, 0))).toBe('Speed camera nearby, 500 metres away.');
    });

    it('F-control. the same camera on your own road -> ahead on it, with the speeding claim', async () => {
      const onRoad: FixedSpeedCamera = { id: 'sapol-F0', label: 'Main North Road, ELIZABETH', position: destinationPoint(START, 470, 0) };
      camera.id = onRoad.id;
      camera.label = onRoad.label;
      camera.position = onRoad.position;
      routeFor = (to) => directionsBody(START, to, [['depart', null, 'Main North Road', 480]]);
      expect(await warning(driverAt(START, 0))).toBe(
        "Speed camera, 500 metres ahead on Main North Road, you're currently over the limit. Reduce speed immediately."
      );
    });
  });
});

describe('road matching: mobile-camera notices ("ahead on X" only while on X)', () => {
  it('driver already on the notice street -> ahead on it', async () => {
    const at = destinationPoint(START, 1_200, 0);
    routeFor = (to) => directionsBody(START, to, [['depart', null, 'Portrush Road', 1_210]]);
    expect(await spoken([alert('G1', 'MOBILE_CAMERA', at, 'PORTRUSH RD', 'Maylands')], driverAt(START, 0))).toBe(
      'Mobile camera, 1.2 kilometres ahead on Portrush Road.'
    );
  });

  it('notice street is where your road continues under a new name, but you are not on it yet -> nearby', async () => {
    const at = destinationPoint(START, 1_200, 0);
    routeFor = (to) =>
      directionsBody(START, to, [
        ['depart', null, 'Glen Osmond Road', 700],
        ['new name', 'straight', 'Portrush Road', 510],
      ]);
    expect(await spoken([alert('G2', 'MOBILE_CAMERA', at, 'PORTRUSH RD', 'Maylands')], driverAt(START, 0))).toBe(
      'Mobile camera nearby on Portrush Road, Maylands, 1.2 kilometres away.'
    );
  });

  it('an ordinary crash on that same continuation is still "ahead" (only camera notices need you on the street)', async () => {
    const at = destinationPoint(START, 1_200, 0);
    routeFor = (to) =>
      directionsBody(START, to, [
        ['depart', null, 'Glen Osmond Road', 700],
        ['new name', 'straight', 'Portrush Road', 510],
      ]);
    expect(await spoken([alert('G3', 'ACCIDENT', at, 'Portrush Rd', 'Maylands')], driverAt(START, 0))).toBe(
      'Crash reported, 1.2 kilometres ahead on Portrush Road.'
    );
  });
});

describe('road matching: cost and fallbacks', () => {
  it('covers a second alert on an already-fetched route without another Directions call', async () => {
    const far = destinationPoint(START, 3_000, 0);
    const near = destinationPoint(START, 1_500, 0);
    routeFor = (to) => directionsBody(START, to, [['depart', null, 'Main North Road', 3_000]]);
    await spoken([alert('far', 'ACCIDENT', far, 'Main North Rd')], driverAt(START, 0));
    expect(requests).toHaveLength(1);

    expect(await spoken([alert('near', 'ACCIDENT', near, 'Main North Rd')], driverAt(START, 0))).toBe(
      'Crash reported, 1.5 kilometres ahead on Main North Road.'
    );
    expect(requests).toHaveLength(1);
    expect(getRoadMatchingStats()).toEqual({ lookups: 1, covered: 1, failures: 0 });
  });

  it('re-measures the along-road distance locally as the driver moves along the route', async () => {
    const at = destinationPoint(START, 3_000, 0);
    routeFor = (to) => directionsBody(START, to, [['depart', null, 'Main North Road', 3_000]]);
    const crash = alert('move', 'ACCIDENT', at, 'Main North Rd');
    await spoken([crash], driverAt(START, 0));
    const later = driverAt(destinationPoint(START, 1_000, 0), 0);
    expect(await spoken([crash], later)).toBe('Crash reported, 2 kilometres ahead on Main North Road.');
    expect(requests).toHaveLength(1);
  });

  it('falls back to "nearby" (never "ahead") when the Directions call fails', async () => {
    const at = destinationPoint(START, 1_500, 0);
    setForwardRouteFetcherForTests(() => Promise.reject(new Error('offline')));
    expect(await spoken([alert('fail', 'ACCIDENT', at, 'Main North Rd')], driverAt(START, 0))).toBe(
      'Crash reported nearby on Main North Road, Elizabeth, 1.5 kilometres away.'
    );
  });

  it('holds an alert while its lookup is out, then says "nearby" after MAX_PENDING_MS rather than waiting forever', async () => {
    const at = destinationPoint(START, 1_500, 0);
    setForwardRouteFetcherForTests(() => new Promise(() => {}));
    const target = { id: 'hang', position: at, streets: ['Main North Rd'], kind: 'alert' as const };
    expect(roadContextFor(target, driverAt(START, 0), NOW)).toBe('pending');
    expect(roadContextFor(target, driverAt(START, 0), NOW + 7_000)).toEqual({ kind: 'nearby' });
  });
});
