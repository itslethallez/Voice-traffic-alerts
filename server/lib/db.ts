import { neon } from '@neondatabase/serverless';

/**
 * HTTP-based driver (not a pooled TCP connection) - matches Vercel
 * Functions' one-shot execution model, where a long-lived pool would just
 * mean a new pool per invocation anyway. DATABASE_URL is set as a Vercel
 * project env var (via `vercel install neon` or pasted from a Neon
 * project's dashboard) and is never exposed to the Expo app.
 */
const databaseUrl = process.env.DATABASE_URL!;
export const sql = neon(databaseUrl);

/**
 * Cold-start connection identity. This codebase has been bitten by the
 * "works via psql, fails in the function" class of bug once already -
 * the same DATABASE_URL can still mean a different database, role, or
 * search_path on the other end, and a catalog check (pg_extension)
 * proves PostGIS exists without proving this role can resolve the
 * `geography` type. The probe reports all four so the deployed log
 * shows what the function actually connected to, not what we assumed.
 * The URL's password is never logged.
 */
try {
  const u = new URL(databaseUrl);
  console.log(
    `[db] url host=${u.hostname} db=${u.pathname.slice(1)} user=${u.username} pooled=${u.hostname.includes('-pooler')}`
  );
} catch {
  console.warn('[db] DATABASE_URL is not a parseable URL');
}

sql`
  SELECT
    current_database() AS db,
    current_user AS usr,
    current_setting('search_path') AS search_path,
    (SELECT n.nspname FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'postgis') AS postgis_schema,
    'POINT(0 0)'::geography::text AS geography_probe
`
  .then(([row]) => console.log(`[db] identity: ${JSON.stringify(row)}`))
  .catch((err) => console.warn('[db] identity probe failed:', err));
