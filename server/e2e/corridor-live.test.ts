/**
 * Live corridor-query check - runs selectCorridorAlerts against a real
 * Neon branch with fixture rows, exercising the actual SQL text
 * (geography casts, ST_DWithin, the bearing wraparound mod() math)
 * rather than a mocked `sql`. This is the class of bug that only a real
 * Postgres can catch: the unit tests mock sql entirely, so a type-
 * coercion failure like `mod(double precision, integer)` ships green
 * until production runs it.
 *
 * Lives outside __tests__/ on purpose so CI never runs it - same
 * convention as ingest-live.test.ts:
 *
 *   npx jest --runTestsByPath server/e2e/corridor-live.test.ts
 *
 * Needs DATABASE_URL (a Neon BRANCH string) in server/.env ONLY, and
 * refuses to run if that string is literally the prod one from the
 * repo-root .env (see .windsurfrules "Dev environment"). Inserts two
 * fixture alerts (one due north of the driver, one due south), runs
 * the query, then deletes those same rows.
 */
import fs from 'fs';
import path from 'path';

function readEnvValue(envPath: string, key: string): string | undefined {
  if (!fs.existsSync(envPath)) return undefined;
  const m = fs.readFileSync(envPath, 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1].trim();
}

const serverEnvPath = path.join(__dirname, '..', '.env');
const dbUrl = readEnvValue(serverEnvPath, 'DATABASE_URL');
if (dbUrl && !process.env.DATABASE_URL) process.env.DATABASE_URL = dbUrl;

const rootProdUrl = readEnvValue(path.join(__dirname, '..', '..', '.env'), 'DATABASE_URL');
const isProdString = Boolean(dbUrl && rootProdUrl && dbUrl === rootProdUrl);
const hasDb = Boolean(dbUrl) && !isProdString;
if (!hasDb) {
  console.warn(
    isProdString
      ? '[corridor-live] server/.env DATABASE_URL is the PROD string from the root .env - refusing to run. Use a Neon branch.'
      : '[corridor-live] no DATABASE_URL in server/.env - skipping. Paste a Neon branch connection string first.'
  );
}

// Deferred requires gated on hasDb: lib/db reads DATABASE_URL at module
// load, so env must be populated first and the requires must not happen
// at all when the test is skipping.
const { sql } = (hasDb ? require('../lib/db') : { sql: null }) as typeof import('../lib/db');
const { selectCorridorAlerts } = (
  hasDb ? require('../lib/postgis-helpers') : { selectCorridorAlerts: null }
) as typeof import('../lib/postgis-helpers');

// Driver sits between two fixture alerts ~1.1 km away: one due north
// (bearing ~0) and one due south (bearing ~180). Both sit beyond
// CORRIDOR_ALWAYS_NEARBY_M (400 m) so the bearing cone is what decides
// inclusion - an alert that survives only via the always-nearby clause
// would mask a broken cone.
const DRIVER = { lat: -34.92, lng: 138.6 };
const NORTH = { lat: -34.91, lng: 138.6 };
const SOUTH = { lat: -34.93, lng: 138.6 };
const TYPES = ['mobile_camera', 'fixed_camera'] as const;

(hasDb ? describe : describe.skip)('selectCorridorAlerts (live Neon)', () => {
  const fixtureIds: string[] = [];

  beforeAll(async () => {
    for (const [type, p] of [
      ['mobile_camera', NORTH],
      ['fixed_camera', SOUTH],
    ] as const) {
      const [{ id }] = await sql`
        INSERT INTO alerts (type, location, radius_m, confidence, source, first_seen, expires_at, corroboration_count)
        VALUES (${type}, ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography,
                250, 80, 'police_notice', now(), now() + interval '1 hour', 0)
        RETURNING id
      `;
      fixtureIds.push(id);
    }
  });

  afterAll(async () => {
    if (fixtureIds.length) {
      await sql`DELETE FROM alerts WHERE id = ANY(${fixtureIds}::uuid[])`;
    }
  });

  it('runs the bearing cone: heading 0 keeps the north alert, drops the south one', async () => {
    const rows = await selectCorridorAlerts({
      lat: DRIVER.lat,
      lng: DRIVER.lng,
      headingDeg: 0,
      radiusMeters: 5000,
      types: [...TYPES],
      limit: 25,
    });

    const ours = rows.filter((r) => fixtureIds.includes(r.id));
    expect(ours.map((r) => r.type)).toEqual(['mobile_camera']);
    // The returned bearing_deg is the wraparound-normalized azimuth -
    // due north should read ~0, and this is the mod() path that broke
    // in production (float8 leaked into a numeric-only function).
    expect(ours[0].bearing_deg).toBeLessThan(15);
  }, 30000);

  it('heading null returns both fixture alerts (cone clause skipped)', async () => {
    const rows = await selectCorridorAlerts({
      lat: DRIVER.lat,
      lng: DRIVER.lng,
      headingDeg: null,
      radiusMeters: 5000,
      types: [...TYPES],
      limit: 25,
    });

    const ours = rows.filter((r) => fixtureIds.includes(r.id)).map((r) => r.type);
    expect(ours.sort()).toEqual([...TYPES].sort());
  }, 30000);
});
