import type { VercelRequest, VercelResponse } from '../../lib/vercel-types';
import { AlertTypeSchema, type AlertType } from '../../../shared/alert-schema';
import {
  selectCorridorAlerts,
  type CorridorAlertRow,
} from '../../lib/postgis-helpers';
import { getRedis } from '../../lib/redis';
import { withSentry, captureException } from '../../lib/sentry';

/**
 * GET /api/alerts/nearby — the corridor-relevance feed the foreground map
 * short-polls every 15–30s. Spatial work lives in
 * lib/postgis-helpers.ts's selectCorridorAlerts(); this handler is only
 * param validation, the Redis read-through cache, and error handling.
 *
 * Params: lat/lng (required), heading (optional — omitted means
 * stationary, corridor degrades to a radius), radiusMeters (optional,
 * capped), types (optional CSV of normalized AlertTypes — the caller's
 * enabled categories; absent means all). The fb_agent publication gate is
 * server-side in the query itself, so no types value a client can send
 * will surface an unreviewed Facebook-derived alert.
 */
const DEFAULT_RADIUS_METERS = 5_000;
const MAX_RADIUS_METERS = 20_000;

/** Cache TTL matches the client's 15–30s poll cadence — the point is to
 * absorb *other* drivers polling the same cells, not to serve stale data
 * to one driver between their own polls. */
const CACHE_TTL_SECONDS = 20;

/**
 * Cache-key quantization: a driver's position only has to be stable enough
 * that two nearby drivers (or one driver's jittery GPS) share a key.
 * ~220m cells and 30° heading buckets are coarse enough to hit, fine
 * enough that a cached corridor is still the corridor the driver is in.
 */
const LAT_LNG_CACHE_GRID_DEG = 0.002;
const HEADING_CACHE_BUCKET_DEG = 30;
const RADIUS_CACHE_BUCKET_M = 500;

function parseNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Parses the `types` CSV into validated AlertTypes. Returns null on any
 * unknown token — strict rather than silently dropping, so a caller with
 * a typo gets a 400 it can see instead of a mysteriously partial feed. */
function parseTypes(raw: unknown): AlertType[] | null {
  if (raw === undefined) return [...AlertTypeSchema.options];
  if (typeof raw !== 'string') return null;
  const tokens = raw.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
  const types: AlertType[] = [];
  for (const token of tokens) {
    const parsed = AlertTypeSchema.safeParse(token);
    if (!parsed.success) return null;
    types.push(parsed.data);
  }
  return types;
}

function cacheKey(
  lat: number,
  lng: number,
  headingDeg: number | null,
  radiusMeters: number,
  types: readonly AlertType[]
): string {
  const latCell = Math.round(lat / LAT_LNG_CACHE_GRID_DEG);
  const lngCell = Math.round(lng / LAT_LNG_CACHE_GRID_DEG);
  const headingCell =
    headingDeg === null
      ? 'none'
      : Math.round(headingDeg / HEADING_CACHE_BUCKET_DEG) % (360 / HEADING_CACHE_BUCKET_DEG);
  const radiusCell = Math.round(radiusMeters / RADIUS_CACHE_BUCKET_M);
  return `corridor:v1:${latCell}:${lngCell}:${headingCell}:${radiusCell}:${types.join(',')}`;
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const lat = parseNumber(req.query.lat);
  const lng = parseNumber(req.query.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    res.status(400).json({ error: 'lat and lng query parameters must be in-range numbers' });
    return;
  }

  let headingDeg: number | null = null;
  if (req.query.heading !== undefined) {
    const heading = parseNumber(req.query.heading);
    if (heading === null || heading < 0 || heading > 360) {
      res.status(400).json({ error: 'heading must be a number in degrees, 0-360' });
      return;
    }
    headingDeg = heading % 360;
  }

  const radiusMeters =
    req.query.radiusMeters === undefined ? DEFAULT_RADIUS_METERS : parseNumber(req.query.radiusMeters);
  if (radiusMeters === null || radiusMeters <= 0 || radiusMeters > MAX_RADIUS_METERS) {
    res.status(400).json({ error: `radiusMeters must be a number in (0, ${MAX_RADIUS_METERS}]` });
    return;
  }

  const types = parseTypes(req.query.types);
  if (types === null) {
    res.status(400).json({ error: `types must be a CSV of: ${AlertTypeSchema.options.join(', ')}` });
    return;
  }
  // Every category filtered out means the corridor is empty by definition —
  // no cache write, no query.
  if (types.length === 0) {
    res.status(200).json([]);
    return;
  }

  const sortedTypes = [...types].sort();
  const key = cacheKey(lat, lng, headingDeg, radiusMeters, sortedTypes);

  try {
    const cached = await getRedis().get<CorridorAlertRow[]>(key);
    if (cached !== null) {
      res.status(200).json(cached);
      return;
    }
  } catch (error) {
    // Cache is an optimization only — Redis being down must never take the
    // endpoint down with it.
    console.warn('[api/alerts/nearby] redis read unavailable, querying Postgres directly', error);
  }

  try {
    const rows = await selectCorridorAlerts({ lat, lng, headingDeg, radiusMeters, types });
    try {
      await getRedis().set(key, rows, { ex: CACHE_TTL_SECONDS });
    } catch (error) {
      console.warn('[api/alerts/nearby] redis write failed, response uncached', error);
    }
    res.status(200).json(rows);
  } catch (error) {
    captureException(error);
    console.error('[api/alerts/nearby] corridor query failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withSentry(handler);
