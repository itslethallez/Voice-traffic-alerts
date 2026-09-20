jest.mock('../../../lib/postgis-helpers', () => ({
  selectCorridorAlerts: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../../lib/redis', () => ({
  getRedis: jest.fn(),
}));

import type { VercelRequest, VercelResponse } from '../../../lib/vercel-types';
import handler from '../nearby';
import { selectCorridorAlerts } from '../../../lib/postgis-helpers';
import { getRedis } from '../../../lib/redis';

const queryMock = selectCorridorAlerts as unknown as jest.Mock;
const redisGet = jest.fn().mockResolvedValue(null);
const redisSet = jest.fn().mockResolvedValue('OK');
(getRedis as unknown as jest.Mock).mockReturnValue({ get: redisGet, set: redisSet });

function mockReq(query: Record<string, string | undefined>, method = 'GET'): VercelRequest {
  return { method, query } as unknown as VercelRequest;
}

function mockRes(): VercelResponse & { status: jest.Mock; json: jest.Mock } {
  const res = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as VercelResponse & { status: jest.Mock; json: jest.Mock };
}

const VALID_QUERY = { lat: '-34.92', lng: '138.60' };

describe('api/alerts/nearby', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getRedis as unknown as jest.Mock).mockReturnValue({ get: redisGet, set: redisSet });
    redisGet.mockResolvedValue(null);
  });

  it('rejects non-GET methods', async () => {
    const res = mockRes();
    await handler(mockReq(VALID_QUERY, 'POST'), res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects missing or out-of-range lat/lng', async () => {
    const res = mockRes();
    await handler(mockReq({ lat: 'x', lng: '138.60' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    const res2 = mockRes();
    await handler(mockReq({ lat: '-91', lng: '138.60' }), res2);
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range heading and an oversized radius', async () => {
    const res = mockRes();
    await handler(mockReq({ ...VALID_QUERY, heading: '370' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    const res2 = mockRes();
    await handler(mockReq({ ...VALID_QUERY, radiusMeters: '50000' }), res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it('rejects an unknown alert type in the types CSV', async () => {
    const res = mockRes();
    await handler(mockReq({ ...VALID_QUERY, types: 'police,ufo' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('passes null heading to the query when the param is absent', async () => {
    const res = mockRes();
    await handler(mockReq(VALID_QUERY), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ lat: -34.92, lng: 138.6, headingDeg: null })
    );
  });

  it('passes the requested types through to the query', async () => {
    const res = mockRes();
    await handler(mockReq({ ...VALID_QUERY, heading: '45', types: 'police,hazard' }), res);
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ headingDeg: 45, types: ['police', 'hazard'] })
    );
  });

  it('returns [] without querying when the caller filtered out every category', async () => {
    const res = mockRes();
    await handler(mockReq({ ...VALID_QUERY, types: ' , ' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('serves a cache hit without touching Postgres', async () => {
    redisGet.mockResolvedValue([{ id: 'cached-1' }]);
    const res = mockRes();
    await handler(mockReq(VALID_QUERY), res);
    expect(res.json).toHaveBeenCalledWith([{ id: 'cached-1' }]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('falls through to Postgres when Redis is down, and still responds', async () => {
    (getRedis as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('no redis env');
    });
    const res = mockRes();
    await handler(mockReq(VALID_QUERY), res);
    expect(queryMock).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
