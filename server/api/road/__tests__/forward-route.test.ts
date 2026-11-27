jest.mock('../../../lib/redis', () => ({ getRedis: jest.fn() }));

import type { VercelRequest, VercelResponse } from '../../../lib/vercel-types';
import handler from '../forward-route';
import { getRedis } from '../../../lib/redis';
import type { StoredDirections } from '../../../lib/routeShare';
import fixtures from '../../../lib/__tests__/fixtures/valhallaAdelaide.json';

const redisGet = jest.fn();
const redisSet = jest.fn().mockResolvedValue('OK');
const fetchMock = jest.fn();

function mockReq(query: Record<string, string>): VercelRequest {
  return { method: 'GET', query } as unknown as VercelRequest;
}
function mockRes(): VercelResponse & { status: jest.Mock; json: jest.Mock } {
  const res = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as VercelResponse & { status: jest.Mock; json: jest.Mock };
}

/** A straight route due north up a road from (-34.80, 138.60), 3km. */
function northRoute(): StoredDirections {
  return {
    code: 'Ok',
    routes: [
      {
        distance: 3_000,
        geometry: { coordinates: [[138.6, -34.8], [138.6, -34.773]] },
        legs: [{ steps: [{ name: 'Main North Road', distance: 3_000, maneuver: { type: 'depart' } }] }],
      },
    ],
    waypoints: [{ distance: 1 }, { distance: 2 }],
  };
}

const ALERT = { toLat: '-34.773', toLng: '138.6' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MAPBOX_ACCESS_TOKEN = 'server-token';
  delete process.env.VALHALLA_URL;
  delete process.env.VALHALLA_SHARED_SECRET;
  (getRedis as unknown as jest.Mock).mockReturnValue({ get: redisGet, set: redisSet });
  redisGet.mockResolvedValue(null);
  fetchMock.mockResolvedValue({ ok: true, json: async () => northRoute() });
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
});

describe('api/road/forward-route', () => {
  it('asks Mapbox on a miss and stores the route under the alert', async () => {
    const res = mockRes();
    await handler(mockReq({ fromLat: '-34.8', fromLng: '138.6', heading: '0', ...ALERT }), res);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('bearings=0%2C45%3B');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ cache: 'miss', router: 'mapbox' }));
    expect(redisSet).toHaveBeenCalledWith('road:v1:-34.77300:138.60000', [{ ...northRoute(), router: 'mapbox' }], { ex: 21_600 });
  });

  it('serves a second driver further along the same road from the cache, with no Mapbox call', async () => {
    redisGet.mockResolvedValue([northRoute()]);
    const res = mockRes();
    await handler(mockReq({ fromLat: '-34.79', fromLng: '138.60003', heading: '5', ...ALERT }), res);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ directions: northRoute(), cache: 'hit', router: 'mapbox' });
  });

  it('does not share with a driver going the other way, off the road, or already at the alert', async () => {
    redisGet.mockResolvedValue([northRoute()]);
    for (const query of [
      { fromLat: '-34.79', fromLng: '138.6', heading: '180' },
      { fromLat: '-34.79', fromLng: '138.602', heading: '0' }, // ~180m off the road
      { fromLat: '-34.7735', fromLng: '138.6', heading: '0' }, // 55m short of it
    ]) {
      fetchMock.mockClear();
      await handler(mockReq({ ...query, ...ALERT }), mockRes());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('still answers from Mapbox when Redis is down', async () => {
    redisGet.mockRejectedValue(new Error('redis down'));
    redisSet.mockRejectedValueOnce(new Error('redis down'));
    const res = mockRes();
    await handler(mockReq({ fromLat: '-34.8', fromLng: '138.6', heading: '0', ...ALERT }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('is not an open proxy: rejects spans over 10km and points outside Australia', async () => {
    const far = mockRes();
    await handler(mockReq({ fromLat: '-34.8', fromLng: '138.6', heading: '0', toLat: '-34.6', toLng: '138.6' }), far);
    expect(far.status).toHaveBeenCalledWith(400);
    const abroad = mockRes();
    await handler(mockReq({ fromLat: '51.5', fromLng: '-0.1', heading: '0', toLat: '51.51', toLng: '-0.1' }), abroad);
    expect(abroad.status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 when Mapbox fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const res = mockRes();
    await handler(mockReq({ fromLat: '-34.8', fromLng: '138.6', heading: '0', ...ALERT }), res);
    expect(res.status).toHaveBeenCalledWith(502);
  });
});

describe('api/road/forward-route - Valhalla first, Mapbox fallback', () => {
  const d0 = (fixtures as unknown as Record<string, { route: unknown; trace: unknown }>).D0;
  const D0_QUERY = { fromLat: '-34.738', fromLng: '138.67581', heading: '357', toLat: '-34.724609', toLng: '138.674093' };
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  beforeEach(() => {
    process.env.VALHALLA_URL = 'https://valhalla.example';
    process.env.VALHALLA_SHARED_SECRET = 'shh';
  });

  it('asks Valhalla (route + trace_attributes, with the secret header) and never Mapbox when it answers', async () => {
    fetchMock.mockResolvedValueOnce(json(d0.route)).mockResolvedValueOnce(json(d0.trace));
    const res = mockRes();
    await handler(mockReq(D0_QUERY), res);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(['https://valhalla.example/route', 'https://valhalla.example/trace_attributes']);
    expect(fetchMock.mock.calls[0][1].headers['x-shotgun-valhalla-secret']).toBe('shh');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).locations[0]).toMatchObject({ heading: 357, heading_tolerance: 45 });
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ cache: 'miss', router: 'valhalla' });
    expect(body.directions.routes[0].legs[0].steps[0]).toMatchObject({ name: 'Main North Road', maneuver: { type: 'depart' } });
    expect(redisSet.mock.calls[0][1][0].router).toBe('valhalla');
  });

  it('falls back to Mapbox when Valhalla errors', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) }).mockResolvedValueOnce(json(northRoute()));
    const res = mockRes();
    await handler(mockReq(D0_QUERY), res);
    expect(String(fetchMock.mock.calls[1][0])).toContain('api.mapbox.com');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ cache: 'miss', router: 'mapbox' }));
  });

  it('falls back to Mapbox when Valhalla has no route (e.g. no path found)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'No path could be found for input' }) }).mockResolvedValueOnce(json(northRoute()));
    const res = mockRes();
    await handler(mockReq(D0_QUERY), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ router: 'mapbox' }));
  });

  it('falls back to Mapbox when Valhalla is slower than the timeout', async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    );
    fetchMock.mockResolvedValueOnce(json(northRoute()));
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      const res = mockRes();
      const pending = handler(mockReq(D0_QUERY), res);
      await jest.advanceTimersByTimeAsync(1_600);
      await pending;
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ router: 'mapbox' }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses Mapbox only when Valhalla is not configured', async () => {
    delete process.env.VALHALLA_URL;
    const res = mockRes();
    await handler(mockReq(D0_QUERY), res);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.mapbox.com');
  });

  it('returns 502 only when both routers fail', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const res = mockRes();
    await handler(mockReq(D0_QUERY), res);
    expect(res.status).toHaveBeenCalledWith(502);
  });
});
