jest.mock('../../lib/db', () => ({ sql: jest.fn() }));
jest.mock('../../lib/notify', () => ({ notifyNewAlert: jest.fn().mockResolvedValue(undefined) }));

import type { VercelRequest, VercelResponse } from '../../lib/vercel-types';
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

const SECRET_ENV_KEYS = [
  'INGEST_SECRET_CROWD_API',
  'INGEST_SECRET_POLICE_NOTICE',
  'INGEST_SECRET_FIXED_DB',
  'INGEST_SECRET_FB_AGENT',
  'INGEST_SECRET_USER_REPORT',
];

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
    for (const key of SECRET_ENV_KEYS) delete process.env[key];
    process.env.INGEST_SECRET_CROWD_API = 'test-secret';
    jest.clearAllMocks();
    (sql as unknown as jest.Mock).mockResolvedValue([{ id: 'uuid-1', ...VALID_ALERT, inserted: true }]);
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

  it('rejects everything when no per-source secret is configured', async () => {
    delete process.env.INGEST_SECRET_CROWD_API;
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('forbids a valid secret used to write a different source', async () => {
    // test-secret resolves to crowd_api; a police_notice payload must
    // 403 even though authentication succeeded.
    const res = mockRes();
    await handler(mockReq({ body: { ...VALID_ALERT, source: 'police_notice' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(sql).not.toHaveBeenCalled();
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

  it('upserts a caller-supplied deterministic id without re-fanning out', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    (sql as unknown as jest.Mock).mockResolvedValue([{ ...VALID_ALERT, id, inserted: false }]);
    const res = mockRes();
    await handler(mockReq({ body: { ...VALID_ALERT, id } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(notifyNewAlert).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid caller id', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { ...VALID_ALERT, id: 'not-a-uuid' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(sql).not.toHaveBeenCalled();
  });

  it('rejects a caller-supplied id on insert-only sources', async () => {
    process.env.INGEST_SECRET_USER_REPORT = 'ur-secret';
    const id = '123e4567-e89b-42d3-a456-426614174000';
    const res = mockRes();
    await handler(
      mockReq({
        headers: { 'x-ingest-secret': 'ur-secret' },
        body: { ...VALID_ALERT, id, source: 'user_report' },
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(sql).not.toHaveBeenCalled();
  });

  it('409s when the id conflicts with a row owned by a different source', async () => {
    // The ON CONFLICT ... WHERE source guard produces zero RETURNING rows.
    (sql as unknown as jest.Mock).mockResolvedValue([]);
    const res = mockRes();
    await handler(
      mockReq({ body: { ...VALID_ALERT, id: '123e4567-e89b-42d3-a456-426614174000' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(notifyNewAlert).not.toHaveBeenCalled();
  });
});
