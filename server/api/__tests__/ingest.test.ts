jest.mock('../../lib/db', () => ({ sql: jest.fn() }));
jest.mock('../../lib/notify', () => ({ notifyNewAlert: jest.fn().mockResolvedValue(undefined) }));

import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../ingest';
import { sql } from '../../lib/db';
import { notifyNewAlert } from '../../lib/notify';

const VALID_ALERT = {
  type: 'police',
  lat: -33.86,
  lng: 151.2,
  radius_m: 250,
  confidence: 85,
  source: 'crowd_api',
  first_seen: '2026-09-17T04:00:00Z',
  expires_at: '2026-09-17T05:00:00Z',
  corroboration_count: 3,
};

function mockReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    headers: { 'x-ingest-secret': 'test-secret' },
    body: VALID_ALERT,
    ...overrides,
  } as VercelRequest;
}

function mockRes(): VercelResponse & { status: jest.Mock; json: jest.Mock } {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as VercelResponse & { status: jest.Mock; json: jest.Mock };
}

describe('api/ingest', () => {
  beforeEach(() => {
    process.env.INGEST_SECRET = 'test-secret';
    jest.clearAllMocks();
    (sql as unknown as jest.Mock).mockResolvedValue([{ id: 'uuid-1', ...VALID_ALERT }]);
  });

  it('rejects non-POST methods', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(sql).not.toHaveBeenCalled();
  });

  it('rejects a missing or wrong ingest secret', async () => {
    const res = mockRes();
    await handler(mockReq({ headers: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(sql).not.toHaveBeenCalled();
  });

  it('rejects everything when INGEST_SECRET is unset', async () => {
    delete process.env.INGEST_SECRET;
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a payload that fails schema validation', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { ...VALID_ALERT, type: 'ufo' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(sql).not.toHaveBeenCalled();
    expect(notifyNewAlert).not.toHaveBeenCalled();
  });

  it('rejects out-of-range values the enums would otherwise allow', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { ...VALID_ALERT, confidence: 101 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('inserts a valid alert and fans out', async () => {
    const res = mockRes();
    await handler(mockReq(), res);
    expect(sql).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(notifyNewAlert).toHaveBeenCalledWith({ id: 'uuid-1', ...VALID_ALERT });
  });
});
