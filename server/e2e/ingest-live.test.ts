/**
 * Live end-to-end check for POST /api/ingest - real HTTP request, real
 * handler, real Neon database. This is the Phase 0 acceptance check, not a
 * unit test: it lives outside __tests__/ on purpose so CI never runs it.
 *
 *   npx jest --runTestsByPath server/e2e/ingest-live.test.ts
 *
 * Needs DATABASE_URL + INGEST_SECRET in server/.env (falls back to the
 * repo-root .env). Inserts one test alert, verifies the PostGIS point, then
 * deletes that same row.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import type { VercelRequest, VercelResponse } from '@vercel/node';

for (const envPath of [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '..', '.env'),
]) {
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
process.env.INGEST_SECRET = process.env.INGEST_SECRET || 'dev-secret';

const hasDb = Boolean(process.env.DATABASE_URL);
// Deferred requires: lib/db reads DATABASE_URL at module load, so env must
// be populated before these imports happen.
const handler = require('../api/ingest').default as (
  req: VercelRequest,
  res: VercelResponse
) => Promise<void>;
const { sql } = require('../lib/db') as typeof import('../lib/db');

const TEST_ALERT = {
  type: 'police',
  lat: -34.9285,
  lng: 138.6007,
  radius_m: 250,
  confidence: 80,
  source: 'user_report',
  first_seen: '2026-09-17T04:00:00Z',
  expires_at: '2026-09-17T05:00:00Z',
  corroboration_count: 0,
};

(hasDb ? describe : describe.skip)('POST /api/ingest (live Neon)', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const r = res as VercelResponse;
      r.status = ((code: number) => {
        res.statusCode = code;
        return r;
      }) as VercelResponse['status'];
      r.json = ((body: unknown) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
        return r;
      }) as VercelResponse['json'];
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        try {
          (req as VercelRequest).body = JSON.parse(data);
        } catch {
          (req as VercelRequest).body = data;
        }
        handler(req as VercelRequest, r);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('accepts a valid alert, stores a real geography point', async () => {
    const resp = await fetch(`http://localhost:${port}/api/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ingest-secret': process.env.INGEST_SECRET!,
      },
      body: JSON.stringify(TEST_ALERT),
    });
    const body = await resp.json();
    expect(resp.status).toBe(201);
    expect(body.id).toBeTruthy();
    expect(body.lat).toBeCloseTo(TEST_ALERT.lat, 4);
    expect(body.lng).toBeCloseTo(TEST_ALERT.lng, 4);

    const rows = await sql`
      SELECT ST_AsText(location::geometry) AS point FROM alerts WHERE id = ${body.id}
    `;
    expect(rows[0].point).toBe(`POINT(${TEST_ALERT.lng} ${TEST_ALERT.lat})`);

    await sql`DELETE FROM alerts WHERE id = ${body.id}`;
  }, 30000);
});
