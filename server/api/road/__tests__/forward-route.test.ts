jest.mock('../../../lib/redis', () => ({ getRedis: jest.fn() }));

import type { VercelRequest, VercelResponse } from '../../../lib/vercel-types';
import handler from '../forward-route';
import { getRedis } from '../../../lib/redis';
import type { StoredDirections } from '../../../lib/routeShare';

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
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ cache: 'miss' }));
    expect(redisSet).toHaveBeenCalledWith('road:v1:-34.77300:138.60000', [northRoute()], { ex: 21_600 });
  });

  it('serves a second driver further along the same road from the cache, with no Mapbox call', async () => {
    redisGet.mockResolvedValue([northRoute()]);
    const res = mockRes();
    await handler(mockReq({ fromLat: '-34.79', fromLng: '138.60003', heading: '5', ...ALERT }), res);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ directions: northRoute(), cache: 'hit' });
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
