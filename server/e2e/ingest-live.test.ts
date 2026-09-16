/**
 * Live end-to-end check for POST /api/ingest - real HTTP request, real
 * handler, real Neon database. This is the Phase 0 acceptance check, not a
 * unit test: it lives outside __tests__/ on purpose so CI never runs it.
 *
 *   npx jest --runTestsByPath server/e2e/ingest-live.test.ts
 *
 * Needs DATABASE_URL (a Neon BRANCH string) + INGEST_SECRET in
 * server/.env. Deliberately reads ONLY server/.env: the repo-root .env
 * holds the production DATABASE_URL and this test must never touch it
 * (see .windsurfrules "Dev environment"). It also refuses to run if
 * server/.env's DATABASE_URL is literally the prod string copied across.
 * Inserts one test alert, verifies the PostGIS point, then deletes that
 * same row.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import type { VercelRequest, VercelResponse } from '@vercel/node';

function readEnvValue(envPath: string, key: string): string | undefined {
  if (!fs.existsSync(envPath)) return undefined;
  const m = fs.readFileSync(envPath, 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1].trim();
}

const serverEnvPath = path.join(__dirname, '..', '.env');
for (const key of [
  'DATABASE_URL',
  'INGEST_SECRET',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'SENTRY_DSN',
]) {
  const value = readEnvValue(serverEnvPath, key);
  if (value && !process.env[key]) process.env[key] = value;
}
process.env.INGEST_SECRET = process.env.INGEST_SECRET || 'dev-secret';

const rootProdUrl = readEnvValue(path.join(__dirname, '..', '..', '.env'), 'DATABASE_URL');
const dbUrl = process.env.DATABASE_URL;
const isProdString = Boolean(dbUrl && rootProdUrl && dbUrl === rootProdUrl);
const hasDb = Boolean(dbUrl) && !isProdString;
if (!hasDb) {
  console.warn(
    isProdString
      ? '[ingest-live] server/.env DATABASE_URL is the PROD string from the root .env - refusing to run. Use a Neon branch.'
      : '[ingest-live] no DATABASE_URL in server/.env - skipping. Paste a Neon branch connection string first.'
  );
}
// Deferred requires gated on hasDb: lib/db reads DATABASE_URL at module
// load (and throws without it), so env must be populated first and the
// requires must not happen at all when the test is skipping.
const handler = (
  hasDb ? require('../api/ingest').default : async () => {}
) as (req: VercelRequest, res: VercelResponse) => Promise<void>;
const { sql } = (
  hasDb ? require('../lib/db') : { sql: null }
) as typeof import('../lib/db');

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
