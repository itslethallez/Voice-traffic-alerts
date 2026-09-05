import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../lib/db';

/**
 * Abuse prevention (deliberately the simplest of three options presented -
 * anonymous per-device ID + rate limiting, no accounts, no corroboration
 * gating, no platform attestation): a device can't post again within this
 * window, and can't exceed this many posts in a rolling day. Starting
 * numbers, not measured against real usage - easy to tune once this is
 * live.
 */
const MIN_SECONDS_BETWEEN_REPORTS = 30;
const MAX_REPORTS_PER_DAY = 20;

/** The categories the report picker offers (ReportButton.tsx) - anything
 * else in the request body falls back to 'POLICE', matching the column's
 * own default for rows written before this category picker existed. */
const ALLOWED_CATEGORIES = new Set(['POLICE', 'ACCIDENT', 'HAZARD']);

/** A report other devices haven't corroborated (or the original reporter's
 * device hasn't refreshed) in this long is treated as no longer live - kept
 * in sync with src/store/manualReportAlert.ts's client-side LIVE_REPORT_WINDOW_MS,
 * which applies the same cutoff to reports already in hand. Filtering here
 * too means a driver miles away, or hours later, never even downloads a
 * report this stale in the first place. */
const LIVE_REPORT_WINDOW_MINUTES = 25;

/** Degrees of latitude per metre, and (at a given latitude) degrees of
 * longitude per metre - a flat-earth approximation, not a geodesic one, but
 * fine for a single-digit-kilometre "nearby" box: the same tradeoff the
 * fixed-cameras/Waze-bounding-box code elsewhere in this app already makes,
 * just inlined here rather than adding a PostGIS extension for one query. */
const METRES_PER_DEGREE_LAT = 111_320;

const REPORTS_SELECT_COLUMNS = `
  id,
  created_at AS "createdAt",
  category,
  subtype,
  lat,
  lng,
  heading_deg AS "headingDeg",
  note,
  confidence,
  corroboration_count AS "corroborationCount",
  last_confirmed_at AS "lastConfirmedAt"
`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    await handlePost(req, res);
    return;
  }
  if (req.method === 'GET') {
    await handleGet(req, res);
    return;
  }
  if (req.method === 'PATCH') {
    await handleConfirm(req, res);
    return;
  }
  if (req.method === 'DELETE') {
    await handleDelete(req, res);
    return;
  }
  res.status(405).json({ error: 'Method not allowed' });
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = req.body ?? {};
  const { deviceId, lat, lng, headingDeg, category, subtype } = body as {
    deviceId?: unknown;
    lat?: unknown;
    lng?: unknown;
    headingDeg?: unknown;
    category?: unknown;
    subtype?: unknown;
  };

  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    res.status(400).json({ error: 'deviceId is required' });
    return;
  }
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'lat and lng must be numbers' });
    return;
  }
  if (headingDeg !== null && headingDeg !== undefined && typeof headingDeg !== 'number') {
    res.status(400).json({ error: 'headingDeg must be a number or null' });
    return;
  }
  if (subtype !== null && subtype !== undefined && typeof subtype !== 'string') {
    res.status(400).json({ error: 'subtype must be a string or null' });
    return;
  }
  const reportCategory = typeof category === 'string' && ALLOWED_CATEGORIES.has(category) ? category : 'POLICE';

  try {
    const [{ recentCount, dailyCount }] = await sql`
      SELECT
        count(*) FILTER (WHERE created_at > now() - interval '30 seconds') AS "recentCount",
        count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS "dailyCount"
      FROM user_reports
      WHERE device_id = ${deviceId}
    `;

    if (Number(recentCount) > 0) {
      res.status(429).json({ error: `Please wait at least ${MIN_SECONDS_BETWEEN_REPORTS}s between reports` });
      return;
    }
    if (Number(dailyCount) >= MAX_REPORTS_PER_DAY) {
      res.status(429).json({ error: 'Daily report limit reached' });
      return;
    }

    const rows = await sql`
      INSERT INTO user_reports (lat, lng, heading_deg, device_id, category, subtype)
      VALUES (${lat}, ${lng}, ${headingDeg ?? null}, ${deviceId}, ${reportCategory}, ${subtype ?? null})
      RETURNING ${sql.unsafe(REPORTS_SELECT_COLUMNS)}
    `;
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('[api/reports] insert failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleGet(req: VercelRequest, res: VercelResponse): Promise<void> {
  const { deviceId, lat, lng, radiusMeters } = req.query;
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    res.status(400).json({ error: 'deviceId query parameter is required' });
    return;
  }

  // Presence of lat/lng/radiusMeters selects "reports near me, from other
  // devices" (the map's nearby-confirmable layer) instead of the default
  // "my own reports, all time" mode (History's hydration on relaunch).
  if (lat !== undefined || lng !== undefined || radiusMeters !== undefined) {
    await handleGetNearby(req, res, deviceId);
    return;
  }

  try {
    const rows = await sql`
      SELECT ${sql.unsafe(REPORTS_SELECT_COLUMNS)}
      FROM user_reports
      WHERE device_id = ${deviceId}
      ORDER BY created_at DESC
    `;
    res.status(200).json(rows);
  } catch (error) {
    console.error('[api/reports] query failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * "Nearby, still-live, from someone else's device" - the feed that lets a
 * driver see and confirm another driver's report on their own map. Never
 * returns the requester's own reports (those already come from their local
 * manualReports state, hydrated by the deviceId-only branch above) and
 * never returns a report no one's confirmed within LIVE_REPORT_WINDOW_MINUTES
 * (a stale report shouldn't even be downloaded, let alone shown as live).
 * The lat/lng box is a loose over-fetch, not an exact radius - the client
 * re-filters by real haversine distance itself (visibleNearbyReportAlerts),
 * same "server does a cheap box, client does the precise check" split
 * fetchAlertsForBoundingBox already uses for Waze's own alerts.
 */
async function handleGetNearby(req: VercelRequest, res: VercelResponse, deviceId: string): Promise<void> {
  const latNum = Number(req.query.lat);
  const lngNum = Number(req.query.lng);
  const radiusNum = Number(req.query.radiusMeters);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    res.status(400).json({ error: 'lat and lng query parameters must be numbers' });
    return;
  }
  if (!Number.isFinite(radiusNum) || radiusNum <= 0) {
    res.status(400).json({ error: 'radiusMeters query parameter must be a positive number' });
    return;
  }

  const latDelta = radiusNum / METRES_PER_DEGREE_LAT;
  const metresPerDegreeLng = METRES_PER_DEGREE_LAT * Math.cos((latNum * Math.PI) / 180);
  const lngDelta = radiusNum / (Math.abs(metresPerDegreeLng) > 1 ? metresPerDegreeLng : 1);

  try {
    const rows = await sql`
      SELECT
        r.id,
        r.created_at AS "createdAt",
        r.category,
        r.subtype,
        r.lat,
        r.lng,
        r.heading_deg AS "headingDeg",
        r.note,
        r.confidence,
        r.corroboration_count AS "corroborationCount",
        r.last_confirmed_at AS "lastConfirmedAt",
        (c.device_id IS NOT NULL) AS "confirmedByRequester"
      FROM user_reports r
      LEFT JOIN report_confirmations c ON c.report_id = r.id AND c.device_id = ${deviceId}
      WHERE r.device_id != ${deviceId}
        AND r.lat BETWEEN ${latNum - latDelta} AND ${latNum + latDelta}
        AND r.lng BETWEEN ${lngNum - lngDelta} AND ${lngNum + lngDelta}
        AND r.last_confirmed_at > now() - interval '1 minute' * ${LIVE_REPORT_WINDOW_MINUTES}
      ORDER BY r.created_at DESC
      LIMIT 200
    `;
    res.status(200).json(rows);
  } catch (error) {
    console.error('[api/reports] nearby query failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * "Still there?" - the one write another driver's device can make to a
 * report it doesn't own. device_id is still the only identity there is, so
 * this both (a) refuses to let a report confirm itself and (b) relies on
 * report_confirmations' (report_id, device_id) primary key to make a
 * second confirmation from the same device a no-op rather than letting one
 * device corroborate its own sighting of the same report repeatedly.
 */
async function handleConfirm(req: VercelRequest, res: VercelResponse): Promise<void> {
  const { id } = req.query;
  const body = req.body ?? {};
  const { deviceId } = body as { deviceId?: unknown };

  if (typeof id !== 'string' || id.length === 0) {
    res.status(400).json({ error: 'id query parameter is required' });
    return;
  }
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    res.status(400).json({ error: 'deviceId is required' });
    return;
  }

  try {
    const [report] = await sql`SELECT device_id AS "deviceId" FROM user_reports WHERE id = ${id}`;
    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    if (report.deviceId === deviceId) {
      res.status(403).json({ error: 'A device cannot confirm its own report' });
      return;
    }

    const inserted = await sql`
      INSERT INTO report_confirmations (report_id, device_id)
      VALUES (${id}, ${deviceId})
      ON CONFLICT (report_id, device_id) DO NOTHING
      RETURNING report_id
    `;

    // Already confirmed by this device before - don't increment again, just
    // return the report's current state so the client still has something
    // to reconcile against.
    const rows =
      inserted.length === 0
        ? await sql`SELECT ${sql.unsafe(REPORTS_SELECT_COLUMNS)} FROM user_reports WHERE id = ${id}`
        : await sql`
            UPDATE user_reports
            SET corroboration_count = corroboration_count + 1, last_confirmed_at = now()
            WHERE id = ${id}
            RETURNING ${sql.unsafe(REPORTS_SELECT_COLUMNS)}
          `;
    res.status(200).json(rows[0]);
  } catch (error) {
    console.error('[api/reports] confirm failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * There are no accounts, so device_id is the only thing that can prove
 * ownership of a report - the WHERE clause below is the entire authorization
 * check, matching handlePost's own "anonymous per-device ID" model above. A
 * deviceId that doesn't own `id` (or an already-deleted/nonexistent `id`)
 * both land on the same 404, rather than leaking which case it was.
 */
async function handleDelete(req: VercelRequest, res: VercelResponse): Promise<void> {
  const { id, deviceId } = req.query;
  if (typeof id !== 'string' || id.length === 0) {
    res.status(400).json({ error: 'id query parameter is required' });
    return;
  }
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    res.status(400).json({ error: 'deviceId query parameter is required' });
    return;
  }

  try {
    const rows = await sql`
      DELETE FROM user_reports
      WHERE id = ${id} AND device_id = ${deviceId}
      RETURNING id
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    res.status(200).json({ id: rows[0].id });
  } catch (error) {
    console.error('[api/reports] delete failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
