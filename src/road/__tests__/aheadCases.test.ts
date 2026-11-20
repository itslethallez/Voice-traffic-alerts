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
  isRoadMatchingDegraded,
  MAX_LOOKUPS_PER_HOUR,
  peekRoadContext,
  resetRoadContext,
  roadContextFor,
  setForwardRouteFetcherForTests,
} from '../roadContextRuntime';

const NOW = Date.parse('2026-11-20T02:00:00.000Z');
/** On Main North Road, Elizabeth (SA), heading north. */
const START: GeoPoint = { latitude: -34.72, longitude: 138.67 };

type Step = [maneuverType: string, modifier: string | null, name: string, distanceMeters: number];

/**
 * A Mapbox Directions (driving, steps=true, geometries=geojson) body.
 * Geometry: straight on (north) for the first step, then to the target -
 * enough for the driver to be "on the route" as they drive up it - unless
 * `geometry` gives the real shape.
 */
function directionsBody(from: GeoPoint, to: GeoPoint, steps: Step[], snapMeters = 3, geometry?: GeoPoint[]) {
  const distance = steps.reduce((sum, s) => sum + s[3], 0);
  const shape = geometry ?? (steps.length > 1 ? [from, destinationPoint(from, steps[0][3], 0), to] : [from, to]);
  return {
    code: 'Ok',
    routes: [
      {
        distance,
        geometry: { coordinates: shape.map((p) => [p.longitude, p.latitude] as [number, number]) },
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

let routeFor: (to: GeoPoint, from: GeoPoint) => ReturnType<typeof directionsBody>;
let requests: Array<{ from: GeoPoint; headingDeg: number; to: GeoPoint }>;

beforeEach(() => {
  resetRoadContext();
  requests = [];
  setForwardRouteFetcherForTests(async (from, headingDeg, to) => {
    requests.push({ from, headingDeg, to });
    return parseForwardRoute(routeFor(to, from));
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
async function spoken(alerts: WazeAlert[], driver: DriverState, nowMs = NOW): Promise<string | null> {
  const radiusFor = alertDistanceFor('normal');
  const settings = { maxDistanceMeters: 5_000, maxDistanceForType: radiusFor, maxBearingDiffDeg: BEHIND_BEARING_DEG };
  const pass = () =>
    applyRoadContext(
      selectAnnounceableAlerts(alerts, driver, new Map(), nowMs, settings),
      (target) => roadContextFor(target, driver, nowMs),
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

  it('C. opposite carriageway of your own road (needs a U-turn; Waze gives no direction) -> "on [road]", no side claimed', async () => {
    // Was silent (U-turn = behind). 21 Nov 2026: same road name, within 60m
    // of my carriageway -> announce it, without claiming which side.
    const at = destinationPoint(START, 2_000, 0);
    routeFor = (to) =>
      directionsBody(START, to, [
        ['depart', null, 'Main North Road', 2_300],
        ['continue', 'uturn', 'Main North Road', 300],
      ]);
    expect(await spoken([alert('C', 'ACCIDENT', at, 'A1 - Main North Rd')], driverAt(START, 0))).toBe(
      'Crash reported on Main North Road, 2 kilometres.'
    );
  });

  it('C3. U-turn to a report on another road -> silent', async () => {
    const at = destinationPoint(START, 2_000, 0);
    routeFor = (to) =>
      directionsBody(START, to, [
        ['depart', null, 'Main North Road', 2_300],
        ['continue', 'uturn', 'Main North Road', 300],
      ]);
    expect(await spoken([alert('C3', 'ACCIDENT', at, 'Service Rd')], driverAt(START, 0))).toBeNull();
  });

  it('C4. U-turn to a same-named report more than 60m off my carriageway -> silent', async () => {
    const at = destinationPoint(destinationPoint(START, 2_000, 0), 150, 90);
    routeFor = (to) =>
      directionsBody(
        START,
        to,
        [
          ['depart', null, 'Main North Road', 2_300],
          ['continue', 'uturn', 'Main North Road', 350],
        ],
        3,
        [START, destinationPoint(START, 2_300, 0), to]
      );
    expect(await spoken([alert('C4', 'ACCIDENT', at, 'Main North Rd')], driverAt(START, 0))).toBeNull();
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
    expect(getRoadMatchingStats()).toMatchObject({ lookups: 1, covered: 1, failures: 0 });
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

  it('never asks about a camera further than the 500m checkpoint (drive test: 60 calls in 4 min on cameras up to 280km away)', () => {
    const asked: string[] = [];
    const far: FixedSpeedCamera = { id: 'far', label: 'Far Road, FARVILLE', position: destinationPoint(START, 30_000, 0) };
    const near: FixedSpeedCamera = { id: 'near', label: 'Main North Road, ELIZABETH', position: destinationPoint(START, 450, 0) };
    selectSpeedCameraWarning({
      driver: driverAt(START, 0),
      speedLimitKmh: null,
      cameras: [far, near],
      alerts: [],
      firedCheckpoints: new Map(),
      nowMs: NOW,
      roadFor: (target) => {
        asked.push(target.id);
        return 'pending';
      },
    });
    expect(asked).toEqual(['near']);
  });

  it('discloses the lookup budget running out as degraded, and recovers when it frees up', async () => {
    routeFor = (to) => directionsBody(START, to, [['depart', null, 'Main North Road', 1_500]]);
    const driver = driverAt(START, 0);
    for (let i = 0; i < MAX_LOOKUPS_PER_HOUR; i++) {
      // Each on its own ray (78m apart at 1.5km), so no cached route covers the next.
      roadContextFor({ id: `b${i}`, position: destinationPoint(START, 1_500, -88 + i * 3), streets: [], kind: 'alert' }, driver, NOW);
      await flush();
    }
    expect(isRoadMatchingDegraded()).toBe(false);
    const over = { id: 'over', position: destinationPoint(START, 1_500, 0), streets: ['Main North Rd'], kind: 'alert' as const };
    expect(roadContextFor(over, driver, NOW)).toEqual({ kind: 'nearby' });
    expect(isRoadMatchingDegraded()).toBe(true);

    roadContextFor({ ...over, id: 'later' }, driver, NOW + 61 * 60_000);
    expect(isRoadMatchingDegraded()).toBe(false);
  });

  it('reuses one route per road segment: no new request while the driver stays on it, a new one only after leaving it', async () => {
    const at = destinationPoint(destinationPoint(START, 1_500, 0), 400, 90);
    routeFor = (to, from) =>
      directionsBody(from, to, [
        ['depart', null, 'Main North Road', 1_500],
        ['turn', 'right', 'Side Street', 400],
      ]);
    const crash = alert('side', 'ACCIDENT', at, 'Side St');
    await spoken([crash], driverAt(START, 0));
    for (let m = 100; m <= 1_400; m += 100) await spoken([crash], driverAt(destinationPoint(START, m, 0), 0));
    expect(requests).toHaveLength(1);
    // Took a parallel road 200m east instead: off the route. Within 30s of
    // the last lookup it's "nearby" without asking; after that, ask again.
    const parallel = driverAt(destinationPoint(destinationPoint(START, 1_000, 0), 200, 90), 0);
    expect(await spoken([crash], parallel, NOW + 20_000)).toBe('Crash reported nearby on Side Street, Elizabeth, 500 metres away.');
    expect(requests).toHaveLength(1);
    await spoken([crash], parallel, NOW + 31_000);
    expect(requests).toHaveLength(2);
  });

  it('a "nearby" becomes "ahead" once the driver takes the turn onto the alert road - from the same route', async () => {
    const corner = destinationPoint(START, 1_500, 0);
    const at = destinationPoint(corner, 400, 90);
    routeFor = (to) =>
      directionsBody(START, to, [
        ['depart', null, 'Main North Road', 1_500],
        ['turn', 'right', 'Side Street', 400],
      ]);
    const crash = alert('turn', 'ACCIDENT', at, 'Side St');
    expect(await spoken([crash], driverAt(START, 0))).toBe(
      'Crash reported nearby on Side Street, Elizabeth, 1.6 kilometres away.'
    );
    expect(await spoken([crash], driverAt(destinationPoint(corner, 50, 90), 90))).toBe(
      'Crash reported, 300 metres ahead on Side Street.' // 350m along, rounded
    );
    expect(requests).toHaveLength(1);
  });

  it('detour limit is 2x straight-line: a 2.5x road distance is "nearby", 1.9x is "ahead"', async () => {
    const at = destinationPoint(START, 1_000, 0);
    routeFor = (to) => directionsBody(START, to, [['depart', null, 'Main North Road', 2_500]]);
    expect(await spoken([alert('d25', 'ACCIDENT', at, 'Main North Rd')], driverAt(START, 0))).toBe(
      'Crash reported nearby on Main North Road, Elizabeth, 1 kilometre away.'
    );
    resetRoadContext();
    routeFor = (to) => directionsBody(START, to, [['depart', null, 'Main North Road', 1_900]]);
    expect(await spoken([alert('d19', 'ACCIDENT', at, 'Main North Rd')], driverAt(START, 0))).toBe(
      'Crash reported, 1.9 kilometres ahead on Main North Road.'
    );
  });

  it('only looks a target up once it is inside its warn radius - a peek never makes a request', () => {
    const target = { id: 'peek', position: destinationPoint(START, 4_000, 0), streets: ['Main North Rd'], kind: 'alert' as const };
    expect(peekRoadContext(target, driverAt(START, 0), NOW)).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('treats a target the driver is moving away from as behind, with no request (drive test: 26 calls for one passed report)', async () => {
    const at = destinationPoint(START, 400, 60);
    routeFor = (to) => directionsBody(START, to, [['depart', null, 'Main North Road', 2_000], ['continue', 'uturn', 'Main North Road', 600]]);
    const target = { id: 'passed', position: at, streets: ['Main North Rd'], kind: 'alert' as const };
    roadContextFor(target, driverAt(START, 0), NOW);
    await flush();
    expect(requests).toHaveLength(1);
    // Turned to head 120deg: the target is back inside the heading cone
    // (41deg off), but 650m further than the closest approach.
    const away = driverAt(destinationPoint(START, 1_200, 0), 120);
    expect(roadContextFor(target, away, NOW + 60_000)).toEqual({ kind: 'behind' });
    expect(requests).toHaveLength(1);
  });
});

describe('road matching: divided road - Sir Donald Bradman Drive (Stage 3 drive test)', () => {
  // The drive turned off Sir Richard Williams Avenue onto Sir Donald
  // Bradman Drive eastbound. A police report on SDB Drive (no direction,
  // like every Waze report) was snapped by Mapbox onto the westbound
  // carriageway ~25m north, so the route was "turn onto SDB, drive past
  // it, U-turn, come back" - and the driver heard nothing. Synthetic
  // geometry, laid out like the real junction.
  const junction: GeoPoint = { latitude: -34.942, longitude: 138.556 };
  const approach = destinationPoint(junction, 500, 270); // on Sir Richard Williams Ave
  const uturnSouth = destinationPoint(junction, 1_600, 90);
  const uturnNorth = destinationPoint(uturnSouth, 25, 0);
  const police = destinationPoint(destinationPoint(junction, 1_200, 90), 25, 0);
  const report = alert('sdb-police', 'POLICE', police, 'Sir Donald Bradman Dr', 'Mile End South');

  beforeEach(() => {
    routeFor = (to) =>
      directionsBody(
        approach,
        to,
        [
          ['depart', null, 'Sir Richard Williams Avenue', 500],
          ['turn', 'right', 'Sir Donald Bradman Drive', 1_600],
          ['continue', 'uturn', 'Sir Donald Bradman Drive', 425],
        ],
        4,
        [approach, junction, uturnSouth, uturnNorth, to]
      );
  });

  it('before turning onto SDB Drive: silent (a turn off my road, then a U-turn)', async () => {
    expect(await spoken([report], driverAt(approach, 90))).toBeNull();
  });

  it('once on SDB Drive: "Police reported on Sir Donald Bradman Drive, X" - no side, no "ahead", no new request', async () => {
    await spoken([report], driverAt(approach, 90));
    expect(await spoken([report], driverAt(destinationPoint(junction, 100, 90), 90))).toBe(
      'Police reported on Sir Donald Bradman Drive, 1.1 kilometres.'
    );
    expect(requests).toHaveLength(1);
  });

  it('a fresh lookup made from SDB Drive gives the same answer', async () => {
    const onSdb = destinationPoint(junction, 100, 90);
    routeFor = (to) =>
      directionsBody(
        onSdb,
        to,
        [
          ['depart', null, 'Sir Donald Bradman Drive', 1_500],
          ['continue', 'uturn', 'Sir Donald Bradman Drive', 425],
        ],
        4,
        [onSdb, uturnSouth, uturnNorth, to]
      );
    expect(await spoken([report], driverAt(onSdb, 90))).toBe('Police reported on Sir Donald Bradman Drive, 1.1 kilometres.');
  });

  it('the camera-style checkpoint warning for a corroborated report there claims no side either', () => {
    expect(
      formatSpeedCameraWarning('report', 500, true, { kind: 'onRoad', roadName: 'Sir Donald Bradman Drive', alongRoadMeters: 480 })
    ).toBe("Police reported on Sir Donald Bradman Drive, 500 metres, you're currently over the limit. Reduce speed immediately.");
  });
});
