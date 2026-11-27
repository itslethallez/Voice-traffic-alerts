import { decodePolyline6, mapManeuver, preferredName, valhallaToDirections, type ValhallaRouteBody, type ValhallaTraceBody } from '../valhalla';
import fixtures from './fixtures/valhallaAdelaide.json';

/** Recorded from Valhalla 3.9.3 on the Geofabrik South Australia extract
 * (21 Nov 2026 trial) - see src/road/__tests__/valhallaCases.test.ts for
 * what road matching makes of each. */
type Fixture = { from: { lat: number; lng: number }; heading: number; to: { lat: number; lng: number }; route: ValhallaRouteBody; trace: ValhallaTraceBody };
const cases = fixtures as unknown as Record<string, Fixture>;

function convert(id: string) {
  const f = cases[id];
  return valhallaToDirections(f.route, f.trace, f.from, f.to);
}
const stepsOf = (id: string) => convert(id).routes[0].legs[0].steps.map((s) => `${s.maneuver.type}${s.maneuver.modifier ? '/' + s.maneuver.modifier : ''}:${s.name || '-'}`);

describe('lib/valhalla', () => {
  it('decodes a precision-6 polyline', () => {
    // Google's documented example, re-encoded at 1e6.
    expect(decodePolyline6('_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });

  it('prefers a road name over its route number', () => {
    expect(preferredName(['A6', 'Sir Donald Bradman Drive'])).toBe('Sir Donald Bradman Drive');
    expect(preferredName(['M1'])).toBe('');
    expect(preferredName(undefined)).toBe('');
  });

  it('maps U-turns, turns and name changes to Mapbox maneuvers', () => {
    expect(mapManeuver(12)).toEqual({ type: 'continue', modifier: 'uturn' });
    expect(mapManeuver(13)).toEqual({ type: 'continue', modifier: 'uturn' });
    expect(mapManeuver(15)).toEqual({ type: 'turn', modifier: 'left' });
    expect(mapManeuver(7)).toEqual({ type: 'new name', modifier: 'straight' });
  });

  it('names Sir Donald Bradman Drive from its edges, not "A6" from the maneuver', () => {
    expect(cases.SDB0.route.trip!.legs[0].maneuvers).toHaveLength(2);
    expect(stepsOf('SDB0')).toEqual(['depart:Sir Donald Bradman Drive', 'arrive:Sir Donald Bradman Drive']);
  });

  it('names a median U-turn after the road it comes back along (not the crossing, "Winifred Street")', () => {
    expect(cases.SDB.trace.edges!.some((e) => (e.names ?? []).includes('Winifred Street'))).toBe(true);
    expect(stepsOf('SDB')).toEqual([
      'depart:Sir Donald Bradman Drive',
      'continue/uturn:Sir Donald Bradman Drive',
      'arrive:Sir Donald Bradman Drive',
    ]);
  });

  it('step distances add up to the route distance, measured along the shape', () => {
    for (const id of Object.keys(cases)) {
      const route = convert(id).routes[0];
      const sum = route.legs[0].steps.reduce((acc, s) => acc + s.distance, 0);
      expect(Math.abs(sum - route.distance)).toBeLessThan(0.01);
    }
  });

  it('reports how far the alert was snapped onto a road, like Mapbox waypoints', () => {
    const d = convert('C4');
    expect(d.waypoints?.[1].distance).toBeGreaterThan(5);
    expect(d.waypoints?.[1].distance).toBeLessThan(40);
    expect(d.router).toBe('valhalla');
  });

  it('throws on a Valhalla error so the endpoint falls back to Mapbox', () => {
    const f = cases.D0;
    expect(() => valhallaToDirections({ error: 'No path could be found', error_code: 442 }, f.trace, f.from, f.to)).toThrow(/No path/);
    expect(() => valhallaToDirections(f.route, { edges: [] }, f.from, f.to)).toThrow(/no edges/);
  });
});
