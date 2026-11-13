import type { MapboxRouteStep } from '../../api/mapbox/types';
import type { DriverState } from '../../engine/types';
import type { GeoPoint } from '../../geo/types';
import { defaultSettingsValues } from '../../store/settingsDefaults';
import { useNavigationStore, type NavigationRoute } from '../../store/useNavigationStore';
import {
  REROUTE_FAILED_BANNER,
  REROUTE_FAILED_NOTICE,
  REROUTING_NOTICE,
  startNavigationWithRoute,
  stopNavigation,
  updateNavigationForDriverUpdate,
} from '../navigationRuntime';

const pulseHaptic = jest.fn();
jest.mock('../../feedback/haptics', () => ({
  pulseHaptic: (pattern: number[]) => pulseHaptic(pattern),
}));

const fetchDirections = jest.fn();
jest.mock('../../api/mapbox/client', () => ({
  ...jest.requireActual('../../api/mapbox/client'),
  fetchDirections: (...args: unknown[]) => fetchDirections(...args),
}));

const speakAsync = jest.fn(async (_text: string, _opts?: { rate?: number; volume?: number }) => {});
const stopSpeaking = jest.fn(async () => {});
jest.mock('../../speech/ttsAdapter', () => ({
  speakAsync: (text: string, opts?: { rate?: number; volume?: number }) => speakAsync(text, opts),
  stopSpeaking: () => stopSpeaking(),
}));

jest.mock('../../store/useTripStore', () => ({
  useTripStore: {
    getState: () => ({ visibleAlerts: [], manualReports: [], nearbyReports: [] }),
  },
}));

jest.mock('../../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      voiceRate: 1,
      voiceVolume: 1,
      categoriesEnabled: defaultSettingsValues.categoriesEnabled,
    }),
  },
}));

/** A straight south-bound "route" out of Adelaide - 1 degree of latitude
 * is ~111.32km, so 0.0045° ≈ 500m, and maneuver locations double as the
 * polyline's own points so the driver is never "off route". */
const DEPART: GeoPoint = { latitude: -34.93, longitude: 138.6 };
const TURN: GeoPoint = { latitude: -34.94, longitude: 138.6 };
const ARRIVE: GeoPoint = { latitude: -34.95, longitude: 138.6 };

function step(at: GeoPoint, instruction: string, distance: number): MapboxRouteStep {
  return {
    maneuver: { instruction, type: 'turn', location: [at.longitude, at.latitude] },
    distance,
    duration: 60,
    name: 'Test St',
    geometry: { type: 'LineString', coordinates: [[at.longitude, at.latitude]] },
  };
}

function makeRoute(): NavigationRoute {
  return {
    polyline: [DEPART, TURN, ARRIVE],
    steps: [
      step(DEPART, 'Head south on Test St', 1113),
      step(TURN, 'Turn left onto Arrival Ave', 1113),
      step(ARRIVE, 'You have arrived at your destination', 0),
    ],
    distanceMeters: 2226,
    durationSeconds: 180,
    hazardScore: 0,
  };
}

const driverAt = (position: GeoPoint): DriverState => ({ position, headingDeg: 180, speedKmh: 50 });
const update = (position: GeoPoint) =>
  updateNavigationForDriverUpdate(driverAt(position), Date.now(), { masterMute: false });

/** ~`meters` north of `point` along the same meridian. */
const northOf = (point: GeoPoint, meters: number): GeoPoint => ({
  latitude: point.latitude + meters / 111_320,
  longitude: point.longitude,
});

beforeEach(() => {
  jest.clearAllMocks();
  stopNavigation(); // resets the store AND navigationRuntime's module-level step tracking
});

describe('startNavigationWithRoute', () => {
  it('adopts the supplied route verbatim and starts navigating without a Directions call', () => {
    const route = makeRoute();
    startNavigationWithRoute({
      destination: ARRIVE,
      destinationLabel: 'Arrival Ave',
      routeType: 'quickest',
      route,
    });

    const state = useNavigationStore.getState();
    expect(state.status).toBe('navigating');
    expect(state.activeRoute).toBe(route);
    expect(state.destination).toEqual(ARRIVE);
    expect(state.destinationLabel).toBe('Arrival Ave');
    expect(state.activeRouteType).toBe('quickest');
    expect(state.remainingDistanceM).toBe(route.distanceMeters);
    expect(fetchDirections).not.toHaveBeenCalled();
  });
});

describe('updateNavigationForDriverUpdate', () => {
  const go = () => {
    startNavigationWithRoute({
      destination: ARRIVE,
      destinationLabel: 'Arrival Ave',
      routeType: 'quickest',
      route: makeRoute(),
    });
  };

  it('announces the upcoming maneuver at the 500m checkpoint, once', async () => {
    go();
    const beforeTurn = northOf(TURN, 480);
    await update(beforeTurn);

    expect(speakAsync).toHaveBeenCalledTimes(1);
    // formatManeuverInstruction folds the instruction into a natural
    // sentence - "In 500 metres, turn left onto Arrival Ave."
    expect(speakAsync.mock.calls[0][0]).toContain('turn left onto Arrival Ave');

    // Same position again - the checkpoint already fired, no repeat.
    await update(beforeTurn);
    expect(speakAsync).toHaveBeenCalledTimes(1);
  });

  it('does not speak when master-muted but still tracks progress', async () => {
    go();
    await updateNavigationForDriverUpdate(driverAt(northOf(TURN, 480)), Date.now(), { masterMute: true });
    expect(speakAsync).not.toHaveBeenCalled();
    expect(useNavigationStore.getState().distanceToNextManeuverM).toBeGreaterThan(400);
  });

  it('advances the step index as the driver reaches each maneuver', async () => {
    go();
    await update(TURN);
    expect(useNavigationStore.getState().currentStepIndex).toBe(1);
  });

  it('fires the 200m and 50m checkpoints for the same maneuver', async () => {
    go();
    await update(northOf(TURN, 480));
    await update(northOf(TURN, 190));
    await update(northOf(TURN, 40));
    expect(speakAsync).toHaveBeenCalledTimes(3);
  });

  it('speaks the arrival instruction and returns to idle on reaching the destination', async () => {
    go();
    await update(TURN); // advance to the final leg
    await update(ARRIVE);

    expect(speakAsync).toHaveBeenLastCalledWith(
      'You have arrived at your destination',
      expect.objectContaining({ rate: 1, volume: 1 })
    );
    const state = useNavigationStore.getState();
    expect(state.status).toBe('idle');
    expect(state.activeRoute).toBeNull();
    expect(state.destination).toBeNull();
  });

  it('gives a haptic arrival cue instead of speech when master-muted, and still ends navigation', async () => {
    go();
    await updateNavigationForDriverUpdate(driverAt(TURN), Date.now(), { masterMute: true });
    await updateNavigationForDriverUpdate(driverAt(ARRIVE), Date.now(), { masterMute: true });

    expect(speakAsync).not.toHaveBeenCalled();
    expect(pulseHaptic).toHaveBeenCalledTimes(1);
    expect(useNavigationStore.getState().status).toBe('idle');
  });
});

describe('rerouting', () => {
  /** ~`meters` east of `point`. */
  const eastOf = (point: GeoPoint, meters: number): GeoPoint => ({
    latitude: point.latitude,
    longitude: point.longitude + meters / (111_320 * Math.cos((point.latitude * Math.PI) / 180)),
  });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  const T0 = 1_800_000_000_000;
  const at = (position: GeoPoint, nowMs: number, masterMute = false) =>
    updateNavigationForDriverUpdate(driverAt(position), nowMs, { masterMute });

  /** On route 600m before the turn, then 100m off it for longer than the
   * sustained off-route window - the second off-route fix fires the reroute. */
  const driveOffRoute = async (masterMute = false, startMs = T0) => {
    const offRoute = eastOf(northOf(TURN, 500), 100);
    await at(offRoute, startMs + 1_000, masterMute);
    await at(offRoute, startMs + 12_000, masterMute);
    await flush();
  };

  beforeEach(() => {
    startNavigationWithRoute({
      destination: ARRIVE,
      destinationLabel: 'Arrival Ave',
      routeType: 'quickest',
      route: makeRoute(),
    });
    fetchDirections.mockRejectedValue(new Error('offline'));
  });

  it('speaks "Rerouting" and, when the reroute fails, a clear failure notice', async () => {
    await at(northOf(TURN, 600), T0);
    await driveOffRoute();

    const spoken = speakAsync.mock.calls.map(([text]) => text);
    expect(spoken).toContain(REROUTING_NOTICE);
    expect(spoken).toContain(REROUTE_FAILED_NOTICE);
    expect(fetchDirections).toHaveBeenCalledTimes(1);
  });

  it('keeps the last known progress and ETA after a failed reroute instead of resetting to step 0', async () => {
    await at(TURN, T0); // step 1 - the reset bug would put this back to step 0
    const offRoute = eastOf(northOf(ARRIVE, 500), 100);
    await at(offRoute, T0 + 1_000);
    await at(offRoute, T0 + 12_000);
    await flush();

    const state = useNavigationStore.getState();
    expect(state.status).toBe('navigating');
    expect(state.errorMessage).toBe(REROUTE_FAILED_BANNER);
    expect(state.currentStepIndex).toBe(1);
    expect(state.remainingDistanceM).toBeLessThan(700);
    expect(state.etaMs).toBeLessThan(T0 + 12_000 + 60_000);
  });

  it('announces a failure once per off-route episode, not on every retry', async () => {
    await at(northOf(TURN, 600), T0);
    await driveOffRoute();
    await driveOffRoute(false, T0 + 20_000);

    expect(fetchDirections).toHaveBeenCalledTimes(2);
    const failures = speakAsync.mock.calls.filter(([text]) => text === REROUTE_FAILED_NOTICE);
    expect(failures).toHaveLength(1);
  });

  it('clears the failure banner once the driver is back on the previous route', async () => {
    await at(northOf(TURN, 600), T0);
    await driveOffRoute();
    await at(northOf(TURN, 400), T0 + 20_000);

    expect(useNavigationStore.getState().errorMessage).toBeNull();
  });

  it('falls back to a haptic pulse for a failed reroute when master-muted', async () => {
    await at(northOf(TURN, 600), T0, true);
    await driveOffRoute(true);

    expect(speakAsync).not.toHaveBeenCalled();
    expect(pulseHaptic).toHaveBeenCalledTimes(1);
    expect(useNavigationStore.getState().errorMessage).toBe(REROUTE_FAILED_BANNER);
  });
});

describe('stopNavigation', () => {
  it('resets the store to idle', () => {
    startNavigationWithRoute({
      destination: ARRIVE,
      destinationLabel: 'Arrival Ave',
      routeType: 'quickest',
      route: makeRoute(),
    });
    stopNavigation();

    const state = useNavigationStore.getState();
    expect(state.status).toBe('idle');
    expect(state.activeRoute).toBeNull();
  });
});
