import type { MapboxDirectionsResponse, MapboxRoute } from '../../api/mapbox/types';
import type { GeoPoint } from '../../geo/types';
import { defaultSettingsValues } from '../../store/settingsDefaults';
import { useNavigationStore } from '../../store/useNavigationStore';
import { useRouteOptionsStore } from '../../store/useRouteOptionsStore';
import { clearRouteOptions, confirmRouteSelection, loadRouteOptions, selectRouteOption } from '../routeOptions';

const fetchDirections = jest.fn();
jest.mock('../../api/mapbox/client', () => ({
  ...jest.requireActual('../../api/mapbox/client'),
  fetchDirections: (...args: unknown[]) => fetchDirections(...args),
}));

// confirmRouteSelection pulls navigationRuntime.ts into the import chain;
// its ttsAdapter dependency drags in expo-speech, which jest can't parse.
jest.mock('../../speech/ttsAdapter', () => ({
  speakAsync: jest.fn(async () => {}),
  stopSpeaking: jest.fn(async () => {}),
}));

let visibleAlerts: { latitude: number; longitude: number; type: string }[] = [];
jest.mock('../../store/useTripStore', () => ({
  useTripStore: {
    getState: () => ({ visibleAlerts, manualReports: [], nearbyReports: [] }),
  },
}));

jest.mock('../../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ categoriesEnabled: defaultSettingsValues.categoriesEnabled }),
  },
}));

const ORIGIN: GeoPoint = { latitude: -34.9285, longitude: 138.6007 };
const DESTINATION: GeoPoint = { latitude: -35.0, longitude: 138.55 };

/** A straight north-south polyline - hazards "on the route" are placed on
 * this longitude inside the corridor; hazards "off" sit far east. */
function straightCoords(lonDelta = 0): [number, number][] {
  const lon = 138.58 + lonDelta;
  return [
    [lon, -34.93],
    [lon, -34.95],
    [lon, -34.97],
    [lon, -34.99],
  ];
}

function makeRoute(
  coordinates: [number, number][],
  { distance = 8000, duration = 600 }: { distance?: number; duration?: number } = {}
): MapboxRoute {
  return {
    geometry: { type: 'LineString', coordinates },
    legs: [{ steps: [], distance, duration, summary: '' }],
    distance,
    duration,
    weight: duration,
    weight_name: 'routability',
  };
}

function directions(...routes: MapboxRoute[]): MapboxDirectionsResponse {
  return {
    code: 'Ok',
    routes,
    waypoints: [
      { location: [ORIGIN.longitude, ORIGIN.latitude], name: 'origin' },
      { location: [DESTINATION.longitude, DESTINATION.latitude], name: 'destination' },
    ],
  };
}

const options = () => useRouteOptionsStore.getState().options;
const optionById = (id: string) => options().find((option) => option.id === id);

beforeEach(() => {
  jest.clearAllMocks();
  visibleAlerts = [];
  useRouteOptionsStore.getState().clear();
});

describe('loadRouteOptions', () => {
  it('fires a default request and a motorway-excluded request in parallel', async () => {
    fetchDirections.mockResolvedValue(directions(makeRoute(straightCoords())));
    await loadRouteOptions(ORIGIN, DESTINATION, 'Seaford');

    expect(fetchDirections).toHaveBeenCalledTimes(2);
    expect(fetchDirections).toHaveBeenNthCalledWith(1, [ORIGIN, DESTINATION], { alternatives: true });
    expect(fetchDirections).toHaveBeenNthCalledWith(2, [ORIGIN, DESTINATION], {
      alternatives: true,
      exclude: 'motorway',
    });
  });

  it('presents fastest, safest and side-streets cards and defaults the selection to fastest', async () => {
    fetchDirections
      .mockResolvedValueOnce(directions(makeRoute(straightCoords())))
      .mockResolvedValueOnce(directions(makeRoute(straightCoords(0.01), { distance: 11000, duration: 780 })));
    await loadRouteOptions(ORIGIN, DESTINATION, 'Seaford');

    expect(useRouteOptionsStore.getState().status).toBe('ready');
    expect(options().map((option) => option.id)).toEqual(['fastest', 'safest', 'sidestreets']);
    expect(useRouteOptionsStore.getState().selectedId).toBe('fastest');
    expect(optionById('sidestreets')?.route.distanceMeters).toBe(11000);
  });

  it('keeps safest identical to fastest when no alternative is less exposed', async () => {
    const route = makeRoute(straightCoords());
    fetchDirections
      .mockResolvedValueOnce(directions(route))
      .mockResolvedValueOnce(directions(route));
    await loadRouteOptions(ORIGIN, DESTINATION, 'Seaford');

    expect(optionById('safest')?.route).toEqual(optionById('fastest')?.route);
  });

  it('ranks a genuinely different alternative as safest when fastest crosses a live hazard', async () => {
    const exposed = makeRoute(straightCoords());
    const clear = makeRoute(straightCoords(0.02), { distance: 9000, duration: 700 });
    fetchDirections
      .mockResolvedValueOnce(directions(exposed, clear))
      .mockResolvedValueOnce(directions(clear));
    visibleAlerts = [{ latitude: -34.95, longitude: 138.58, type: 'ACCIDENT' }];
    await loadRouteOptions(ORIGIN, DESTINATION, 'Seaford');

    const fastest = optionById('fastest');
    const safest = optionById('safest');
    expect(fastest?.hazardsOnRoute).toHaveLength(1);
    expect(safest?.route.distanceMeters).toBe(9000);
    expect(safest?.hazardsOnRoute).toHaveLength(0);
  });

  it('ignores hazards outside the route corridor', async () => {
    fetchDirections
      .mockResolvedValueOnce(directions(makeRoute(straightCoords())))
      .mockResolvedValueOnce(directions(makeRoute(straightCoords(0.01))));
    visibleAlerts = [{ latitude: -34.95, longitude: 138.61, type: 'ACCIDENT' }];
    await loadRouteOptions(ORIGIN, DESTINATION, 'Seaford');

    expect(optionById('fastest')?.hazardsOnRoute).toHaveLength(0);
  });

  it('ignores hazards whose alert category is disabled in settings', async () => {
    fetchDirections
      .mockResolvedValueOnce(directions(makeRoute(straightCoords())))
      .mockResolvedValueOnce(directions(makeRoute(straightCoords())));
    // FIXED_CAMERA is off by default in categoriesEnabled - a camera on the
    // route must not count as a live incident the way an ACCIDENT would.
    visibleAlerts = [{ latitude: -34.95, longitude: 138.58, type: 'FIXED_CAMERA' }];
    await loadRouteOptions(ORIGIN, DESTINATION, 'Seaford');

    expect(optionById('fastest')?.hazardsOnRoute).toHaveLength(0);
  });

  it('omits the side-streets card when Mapbox returns no motorway-free route', async () => {
    fetchDirections
      .mockResolvedValueOnce(directions(makeRoute(straightCoords())))
      .mockResolvedValueOnce({ code: 'Ok', routes: [], waypoints: [] });
    await loadRouteOptions(ORIGIN, DESTINATION, 'Nearby');

    expect(options().map((option) => option.id)).toEqual(['fastest', 'safest']);
  });

  it('surfaces an error state when Directions fails', async () => {
    fetchDirections.mockRejectedValue(new Error('network down'));
    await loadRouteOptions(ORIGIN, DESTINATION, 'Seaford');

    expect(useRouteOptionsStore.getState().status).toBe('error');
    expect(useRouteOptionsStore.getState().errorMessage).toBeTruthy();
  });

  it('a cleared plan cannot be clobbered by a fetch still in flight', async () => {
    let resolveFirst: (value: MapboxDirectionsResponse) => void = () => {};
    fetchDirections
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(directions(makeRoute(straightCoords())));
    const inFlight = loadRouteOptions(ORIGIN, DESTINATION, 'Seaford');
    clearRouteOptions();
    resolveFirst(directions(makeRoute(straightCoords())));
    await inFlight;

    expect(useRouteOptionsStore.getState().status).toBe('idle');
    expect(options()).toHaveLength(0);
  });
});

describe('selectRouteOption / clearRouteOptions', () => {
  it('select marks the chosen card', async () => {
    fetchDirections
      .mockResolvedValueOnce(directions(makeRoute(straightCoords())))
      .mockResolvedValueOnce(directions(makeRoute(straightCoords(0.01))));
    await loadRouteOptions(ORIGIN, DESTINATION, 'Seaford');

    selectRouteOption('sidestreets');
    expect(useRouteOptionsStore.getState().selectedId).toBe('sidestreets');
  });

  it('clear resets the whole plan to idle', async () => {
    fetchDirections.mockResolvedValue(directions(makeRoute(straightCoords())));
    await loadRouteOptions(ORIGIN, DESTINATION, 'Seaford');
    clearRouteOptions();

    const state = useRouteOptionsStore.getState();
    expect(state.status).toBe('idle');
    expect(state.destination).toBeNull();
    expect(state.options).toHaveLength(0);
    expect(state.selectedId).toBeNull();
  });
});

describe('confirmRouteSelection', () => {
  it('hands the selected option route to navigation without re-fetching, then clears the plan', async () => {
    fetchDirections
      .mockResolvedValueOnce(directions(makeRoute(straightCoords())))
      .mockResolvedValueOnce(directions(makeRoute(straightCoords(0.01), { distance: 11000 })));
    await loadRouteOptions(ORIGIN, DESTINATION, 'Seaford');
    selectRouteOption('sidestreets');
    const chosen = optionById('sidestreets')?.route;
    fetchDirections.mockClear();

    confirmRouteSelection();

    const nav = useNavigationStore.getState();
    expect(nav.status).toBe('navigating');
    // The geometry the driver tapped GO on is exactly what they got - the
    // sidestreets option's own route object, not a fresh Directions result.
    expect(nav.activeRoute).toBe(chosen);
    expect(nav.activeRoute?.distanceMeters).toBe(11000);
    expect(nav.destination).toEqual(DESTINATION);
    expect(nav.destinationLabel).toBe('Seaford');
    expect(fetchDirections).not.toHaveBeenCalled();

    // The plan stood down as navigation chrome took over.
    const plan = useRouteOptionsStore.getState();
    expect(plan.status).toBe('idle');
    expect(plan.options).toHaveLength(0);

    useNavigationStore.getState().stop();
  });

  it('maps the fastest card to the quickest route type', async () => {
    fetchDirections.mockResolvedValue(directions(makeRoute(straightCoords())));
    await loadRouteOptions(ORIGIN, DESTINATION, 'Seaford');

    confirmRouteSelection();

    expect(useNavigationStore.getState().activeRouteType).toBe('quickest');
    useNavigationStore.getState().stop();
  });

  it('is a no-op with no plan in flight', () => {
    confirmRouteSelection();
    expect(useNavigationStore.getState().status).toBe('idle');
  });
});
