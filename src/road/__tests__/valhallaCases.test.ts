/**
 * The audit cases at real Adelaide locations, answered by Valhalla
 * (recorded: server/lib/__tests__/fixtures/valhallaAdelaide.json), through
 * the server's Valhalla -> Mapbox-shape conversion and the app's real
 * road-matching runtime. The 21 Nov 2026 trial ran these against live
 * Mapbox too: same verdict on every case, along-road distance within 2m.
 * Since then case C's rule changed (a same-named report within 60m of my
 * road is "on [road]" whatever the router does), so C is now onRoad.
 */
jest.mock('../../config/env', () => ({ env: { mapboxAccessToken: 'test-token' } }));

import { parseForwardRoute, type DirectionsBody } from '../../api/mapbox/forwardRoute';
import type { DriverState, RoadContext } from '../../engine/types';
import { valhallaToDirections, type ValhallaRouteBody, type ValhallaTraceBody } from '../../../server/lib/valhalla';
import fixtures from '../../../server/lib/__tests__/fixtures/valhallaAdelaide.json';
import type { RoadTarget } from '../classifyRoute';
import { roadNamesIn } from '../roadNames';
import { resetRoadContext, roadContextFor, setForwardRouteFetcherForTests } from '../roadContextRuntime';

type Fixture = { from: { lat: number; lng: number }; heading: number; to: { lat: number; lng: number }; route: ValhallaRouteBody; trace: ValhallaTraceBody };
const cases = fixtures as unknown as Record<string, Fixture>;
const NOW = Date.parse('2026-11-21T02:00:00.000Z');
const flush = () => new Promise((resolve) => setImmediate(resolve));

afterAll(() => setForwardRouteFetcherForTests(null));

async function verdict(fixtureId: string, streets: string[], kind: RoadTarget['kind']): Promise<RoadContext> {
  const f = cases[fixtureId];
  resetRoadContext();
  setForwardRouteFetcherForTests(async () => parseForwardRoute(valhallaToDirections(f.route, f.trace, f.from, f.to) as DirectionsBody));
  const driver: DriverState = { position: { latitude: f.from.lat, longitude: f.from.lng }, headingDeg: f.heading, speedKmh: 80, headingReliable: true };
  const target: RoadTarget = { id: fixtureId, position: { latitude: f.to.lat, longitude: f.to.lng }, streets, kind };
  expect(roadContextFor(target, driver, NOW)).toBe('pending');
  await flush();
  await flush();
  const answer = roadContextFor(target, driver, NOW + 1);
  if (answer === 'pending') throw new Error('still pending');
  return answer;
}

const along = (c: RoadContext) => (c.kind === 'ahead' || c.kind === 'onRoad' ? Math.round(c.alongRoadMeters) : null);

describe('road matching on real Valhalla routes (Adelaide)', () => {
  it('A. crash on Portland Rd, parallel 1km east -> nearby (off my road)', async () => {
    expect(await verdict('A', ['Portland Rd'], 'alert')).toEqual({ kind: 'nearby', offRoad: true });
  });

  it('B. crash on Ballard St, a cross street 700m off -> nearby (off my road)', async () => {
    expect(await verdict('B', ['Ballard St'], 'alert')).toEqual({ kind: 'nearby', offRoad: true });
  });

  it('C. crash on Main North Rd southbound carriageway (router loops via Yorktown Rd) -> on Main North Road', async () => {
    const c = await verdict('C', ['A1 - Main North Rd'], 'alert');
    expect(c).toMatchObject({ kind: 'onRoad', roadName: 'Main North Road' });
    expect(along(c)).toBeGreaterThan(1_950);
    expect(along(c)).toBeLessThan(2_050);
  });

  it('C3. same spot, report names another road -> silent (behind)', async () => {
    expect(await verdict('C', ['Service Rd'], 'alert')).toEqual({ kind: 'behind' });
  });

  it('C4. "Main North Rd" report 150m off the road (on Bellinger Rd) -> nearby, not "on Main North Road"', async () => {
    expect((await verdict('C4', ['Main North Rd'], 'alert')).kind).toBe('nearby');
  });

  it('D. South Eastern Freeway bend, crash 52 degrees off heading -> ahead, 1.5km along', async () => {
    const c = await verdict('D', ['M1 - South Eastern Fwy'], 'alert');
    expect(c).toMatchObject({ kind: 'ahead', roadName: 'South Eastern Freeway' });
    expect(along(c)).toBe(1_500);
  });

  it('D0. straight up Main North Rd -> ahead, 1.5km', async () => {
    const c = await verdict('D0', ['A1 - Main North Rd'], 'alert');
    expect(c).toMatchObject({ kind: 'ahead', roadName: 'Main North Road' });
    expect(along(c)).toBe(1_500);
  });

  it('F. fixed camera on Derrick Rd, parallel -> silent (behind: reached by a U-turn)', async () => {
    expect(await verdict('F', roadNamesIn('Derrick Road, ELIZABETH'), 'fixedCamera')).toEqual({ kind: 'behind' });
  });

  it('F2. fixed camera on Main North Road Service Road -> off my road (silent as a camera warning)', async () => {
    expect(await verdict('F2', roadNamesIn('Main North Road Service Road, ELIZABETH'), 'fixedCamera')).toEqual({ kind: 'nearby', offRoad: true });
  });

  it('F0. fixed camera on Main North Rd 470m up -> ahead', async () => {
    const c = await verdict('F0', roadNamesIn('Main North Road, ELIZABETH'), 'fixedCamera');
    expect(c).toMatchObject({ kind: 'ahead', roadName: 'Main North Road' });
    expect(along(c)).toBe(470);
  });

  it.each([
    ['SDB', 'westbound carriageway'],
    ['SDBm', 'median'],
  ])('%s. police on Sir Donald Bradman Dr %s -> on Sir Donald Bradman Drive, ~1.2km, no side', async (id) => {
    const c = await verdict(id, ['Sir Donald Bradman Dr'], 'alert');
    expect(c).toMatchObject({ kind: 'onRoad', roadName: 'Sir Donald Bradman Drive' });
    expect(along(c)).toBeGreaterThan(1_190);
    expect(along(c)).toBeLessThan(1_215);
  });

  it('SDB0. police on my side of Sir Donald Bradman Dr -> ahead', async () => {
    const c = await verdict('SDB0', ['Sir Donald Bradman Dr'], 'alert');
    expect(c).toMatchObject({ kind: 'ahead', roadName: 'Sir Donald Bradman Drive' });
    expect(along(c)).toBeGreaterThan(1_190);
    expect(along(c)).toBeLessThan(1_215);
  });
});
