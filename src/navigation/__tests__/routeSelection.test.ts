import type { MapboxDirectionsResponse, MapboxRoute } from '../../api/mapbox/types';
import type { RouteHazard } from '../../engine/routeHazardScore';
import { scoreAndRankRoutes, toPolyline } from '../routeSelection';

// routeSelection.ts imports the trip/settings stores for
// getHazardsForRouteScoring - mocked so the store chain (config/deviceId
// -> expo-crypto, an ESM-only module) never loads under jest.
jest.mock('../../store/useTripStore', () => ({
  useTripStore: { getState: () => ({ visibleAlerts: [], manualReports: [], nearbyReports: [] }) },
}));
jest.mock('../../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ categoriesEnabled: {} }) },
}));

function makeRoute(coordinates: [number, number][], distance = 1000): MapboxRoute {
  return {
    geometry: { type: 'LineString', coordinates },
    legs: [{ steps: [], distance, duration: distance / 15, summary: '' }],
    distance,
    duration: distance / 15,
    weight: distance,
    weight_name: 'routability',
  };
}

function makeResponse(routes: MapboxRoute[]): MapboxDirectionsResponse {
  return { code: 'Ok', routes, waypoints: [] };
}

// route A hugs a hazard; route B is a clean parallel path far away.
const ROUTE_A = makeRoute([[138.6, -34.93], [138.6, -34.92]]);
const ROUTE_B = makeRoute([[139.6, -35.93], [139.6, -35.92]]);
const HAZARD_ON_A: RouteHazard = { latitude: -34.925, longitude: 138.6, type: 'ACCIDENT' };

describe('toPolyline', () => {
  it('converts Mapbox [lon,lat] geometry into GeoPoint [lat,lon] objects', () => {
    expect(toPolyline(ROUTE_A)).toEqual([
      { latitude: -34.93, longitude: 138.6 },
      { latitude: -34.92, longitude: 138.6 },
    ]);
  });
});

describe('scoreAndRankRoutes', () => {
  it('preserves Mapbox order and scores everything 0 when avoidHazards is off', () => {
    const ranked = scoreAndRankRoutes(makeResponse([ROUTE_A, ROUTE_B]), [HAZARD_ON_A], false);
    expect(ranked.map((r) => r.route)).toEqual([ROUTE_A, ROUTE_B]);
    expect(ranked.every((r) => r.hazardScore === 0)).toBe(true);
  });

  it('ranks the less hazard-exposed route first when avoidHazards is on', () => {
    // ROUTE_A is listed first (Mapbox's own pick) but passes right by the hazard.
    const ranked = scoreAndRankRoutes(makeResponse([ROUTE_A, ROUTE_B]), [HAZARD_ON_A], true);
    expect(ranked[0].route).toBe(ROUTE_B);
    expect(ranked[0].hazardScore).toBe(0);
    expect(ranked[1].route).toBe(ROUTE_A);
    expect(ranked[1].hazardScore).toBeGreaterThan(0);
  });

  it('keeps Mapbox order as a tiebreaker when hazard scores are equal', () => {
    const ranked = scoreAndRankRoutes(makeResponse([ROUTE_A, ROUTE_B]), [], true);
    expect(ranked.map((r) => r.route)).toEqual([ROUTE_A, ROUTE_B]);
  });

  it('records each route\'s original Mapbox rank', () => {
    const ranked = scoreAndRankRoutes(makeResponse([ROUTE_A, ROUTE_B]), [HAZARD_ON_A], true);
    const forRouteA = ranked.find((r) => r.route === ROUTE_A);
    expect(forRouteA?.mapboxRank).toBe(0);
  });
});
