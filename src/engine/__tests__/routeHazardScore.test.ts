import { hazardsNearRoute, scoreRouteHazardExposure, type RouteHazard } from '../routeHazardScore';

const ROAD_START = { latitude: -34.92168, longitude: 138.59739 };
const ROAD_END = { latitude: -34.9155556, longitude: 138.59739 };
const ROAD = [ROAD_START, ROAD_END];

function hazardAt(latitude: number, longitude: number, type: RouteHazard['type']): RouteHazard {
  return { latitude, longitude, type };
}

describe('hazardsNearRoute', () => {
  it('includes a hazard within the corridor and excludes one outside it', () => {
    const onRoute = hazardAt(ROAD_START.latitude, ROAD_START.longitude, 'HAZARD');
    const farAway = hazardAt(0, 0, 'HAZARD');
    const result = hazardsNearRoute(ROAD, [onRoute, farAway], 200);
    expect(result).toHaveLength(1);
    expect(result[0].hazard).toBe(onRoute);
  });

  it('sorts nearest first', () => {
    const near = hazardAt(ROAD_START.latitude, ROAD_START.longitude, 'HAZARD');
    const mid = {
      latitude: (ROAD_START.latitude + ROAD_END.latitude) / 2,
      longitude: ROAD_START.longitude + 0.0005,
      type: 'HAZARD' as const,
    };
    const result = hazardsNearRoute(ROAD, [mid, near], 200);
    expect(result.map((r) => r.hazard)).toEqual([near, mid]);
  });
});

describe('scoreRouteHazardExposure', () => {
  it('is zero when nothing is near the route', () => {
    const farAway = hazardAt(0, 0, 'ACCIDENT');
    expect(scoreRouteHazardExposure(ROAD, [farAway], 200)).toBe(0);
  });

  it('weighs a more severe hazard type higher than a less severe one', () => {
    const accident = hazardAt(ROAD_START.latitude, ROAD_START.longitude, 'ACCIDENT');
    const jam = hazardAt(ROAD_START.latitude, ROAD_START.longitude, 'JAM');
    const accidentScore = scoreRouteHazardExposure(ROAD, [accident], 200);
    const jamScore = scoreRouteHazardExposure(ROAD, [jam], 200);
    expect(accidentScore).toBeGreaterThan(jamScore);
  });

  it('accumulates across multiple hazards on the same route', () => {
    const one = hazardAt(ROAD_START.latitude, ROAD_START.longitude, 'HAZARD');
    const two = hazardAt(ROAD_END.latitude, ROAD_END.longitude, 'HAZARD');
    const singleScore = scoreRouteHazardExposure(ROAD, [one], 200);
    const doubleScore = scoreRouteHazardExposure(ROAD, [one, two], 200);
    expect(doubleScore).toBe(singleScore * 2);
  });

  it('treats an unrecognized alert type as lowest severity rather than throwing', () => {
    const unknown = hazardAt(ROAD_START.latitude, ROAD_START.longitude, 'SOMETHING_NEW');
    expect(() => scoreRouteHazardExposure(ROAD, [unknown], 200)).not.toThrow();
    expect(scoreRouteHazardExposure(ROAD, [unknown], 200)).toBeGreaterThanOrEqual(0);
  });
});
