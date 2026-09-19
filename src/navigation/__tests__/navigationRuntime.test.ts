import type { MapboxRouteStep } from '../../api/mapbox/types';
import type { DriverState } from '../../engine/types';
import type { GeoPoint } from '../../geo/types';
import { defaultSettingsValues } from '../../store/settingsDefaults';
import { useNavigationStore, type NavigationRoute } from '../../store/useNavigationStore';
import {
  startNavigationWithRoute,
  stopNavigation,
  updateNavigationForDriverUpdate,
} from '../navigationRuntime';

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

  it('skips arrival speech when master-muted but still ends navigation', async () => {
    go();
    await updateNavigationForDriverUpdate(driverAt(TURN), Date.now(), { masterMute: true });
    await updateNavigationForDriverUpdate(driverAt(ARRIVE), Date.now(), { masterMute: true });

    expect(speakAsync).not.toHaveBeenCalled();
    expect(useNavigationStore.getState().status).toBe('idle');
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
