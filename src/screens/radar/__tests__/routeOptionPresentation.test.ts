import type { RouteOption, RouteOptionId } from '../../../store/useRouteOptionsStore';
import type { RouteHazard } from '../../../engine/routeHazardScore';
import type { WazeAlertType } from '../../../api/waze/types';
import {
  buildRouteOptionReason,
  formatRouteDistance,
  formatRouteDuration,
} from '../routeOptionPresentation';

function hazard(type: WazeAlertType): RouteHazard {
  return { latitude: -34.95, longitude: 138.6, type };
}

interface OptionFixture {
  distance?: number;
  duration?: number;
  points?: number;
  hazards?: RouteHazard[];
}

function makeOption(id: RouteOptionId, fixture: OptionFixture = {}): RouteOption {
  const { distance = 8000, duration = 600, points = 20, hazards = [] } = fixture;
  return {
    id,
    route: {
      polyline: Array.from({ length: points }, (_, index) => ({ latitude: -34.9 - index * 0.001, longitude: 138.6 })),
      steps: [],
      distanceMeters: distance,
      durationSeconds: duration,
      hazardScore: hazards.length,
    },
    hazardsOnRoute: hazards.map((h, index) => ({ hazard: h, distanceMeters: 40 + index })),
  };
}

describe('formatRouteDuration', () => {
  it('formats minutes under an hour and hr/min above', () => {
    expect(formatRouteDuration(1440)).toBe('24 min');
    expect(formatRouteDuration(60)).toBe('1 min');
    expect(formatRouteDuration(3900)).toBe('1 hr 5 min');
  });
});

describe('formatRouteDistance', () => {
  it('formats metres under a km, one decimal under 10, whole above', () => {
    expect(formatRouteDistance(950)).toBe('950 m');
    expect(formatRouteDistance(8200)).toBe('8.2 km');
    expect(formatRouteDistance(18200)).toBe('18 km');
  });
});

describe('buildRouteOptionReason', () => {
  it('fastest always reads "Fastest available"', () => {
    const options = [makeOption('fastest'), makeOption('safest'), makeOption('sidestreets')];
    expect(buildRouteOptionReason(options[0], options)).toBe('Fastest available');
  });

  it('says fastest is already the clearest when safest kept the same geometry', () => {
    const shared = { distance: 8000, duration: 600, points: 20 };
    const options = [makeOption('fastest', shared), makeOption('safest', shared)];
    expect(buildRouteOptionReason(options[1], options)).toBe('Fastest route is already the clearest');
  });

  it('names the avoided hazard count, type and time cost when safest diverges', () => {
    const fastest = makeOption('fastest', { hazards: [hazard('ACCIDENT')] });
    const safest = makeOption('safest', { distance: 9600, duration: 960, points: 26 });
    expect(buildRouteOptionReason(safest, [fastest, safest])).toBe('Avoids 1 reported accident · +6 min');
  });

  it('only names hazards the safest route actually misses, not every hazard on fastest', () => {
    // The closure sits on both routes - only the accident is avoided, so
    // the copy must not claim otherwise.
    const closure = hazard('ROAD_CLOSED');
    const fastest = makeOption('fastest', { hazards: [hazard('ACCIDENT'), closure] });
    const safest = makeOption('safest', { distance: 9600, duration: 960, points: 26, hazards: [closure] });
    expect(buildRouteOptionReason(safest, [fastest, safest])).toBe('Avoids 1 reported accident · +6 min');
  });

  it('pluralises when several hazards are avoided and names their types', () => {
    const fastest = makeOption('fastest', { hazards: [hazard('ACCIDENT'), hazard('ROAD_CLOSED'), hazard('ACCIDENT')] });
    const safest = makeOption('safest', { distance: 9600, duration: 960, points: 26 });
    expect(buildRouteOptionReason(safest, [fastest, safest])).toBe('Avoids 3 reported incidents (accident + road closure) · +6 min');
  });

  it('falls back to "least exposed" when safest diverges without dropping a hazard', () => {
    const police = hazard('POLICE');
    const fastest = makeOption('fastest', { hazards: [police] });
    const safest = makeOption('safest', { distance: 9600, duration: 960, points: 26, hazards: [police, hazard('JAM')] });
    expect(buildRouteOptionReason(safest, [fastest, safest])).toBe('Least exposed to reported incidents');
  });

  it('side streets notes when the motorway-free route collapsed onto the default', () => {
    const shared = { distance: 8000, duration: 600, points: 20 };
    const options = [makeOption('fastest', shared), makeOption('sidestreets', shared)];
    expect(buildRouteOptionReason(options[1], options)).toBe('No motorway on this route');
  });

  it('side streets reads "avoids the highway" with the time cost when it diverges', () => {
    const fastest = makeOption('fastest');
    const sideStreets = makeOption('sidestreets', { distance: 11400, duration: 1140, points: 40 });
    expect(buildRouteOptionReason(sideStreets, [fastest, sideStreets])).toBe('Avoids the highway · +9 min');
  });
});
