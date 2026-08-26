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

const REPORTS_SELECT_COLUMNS = `
  id,
  created_at AS "createdAt",
  category,
  lat,
  lng,
  heading_deg AS "headingDeg",
  note,
  confidence,
  corroboration_count AS "corroborationCount"
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
  res.status(405).json({ error: 'Method not allowed' });
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = req.body ?? {};
  const { deviceId, lat, lng, headingDeg } = body as {
    deviceId?: unknown;
    lat?: unknown;
    lng?: unknown;
    headingDeg?: unknown;
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
      INSERT INTO user_reports (lat, lng, heading_deg, device_id)
      VALUES (${lat}, ${lng}, ${headingDeg ?? null}, ${deviceId})
      RETURNING ${sql.unsafe(REPORTS_SELECT_COLUMNS)}
    `;
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('[api/reports] insert failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleGet(req: VercelRequest, res: VercelResponse): Promise<void> {
  const { deviceId } = req.query;
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    res.status(400).json({ error: 'deviceId query parameter is required' });
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
