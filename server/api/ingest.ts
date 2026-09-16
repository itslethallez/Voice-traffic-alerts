import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../lib/db';
import { withSentry, captureException } from '../lib/sentry';
import { notifyNewAlert } from '../lib/notify';
import { NormalizedAlertSchema } from '../../shared/alert-schema';

/**
 * The single write path into the `alerts` table: every source (crowd API
 * mirror, police notice scraper, fixed-camera load, Facebook agent, user
 * reports) posts here, and this is where the shared Zod schema is enforced -
 * a payload that fails validation never reaches Postgres.
 *
 * Auth is the INGEST_SECRET shared secret in the x-ingest-secret header:
 * the callers are server-to-server (QStash-triggered jobs, scheduled
 * scripts), not app clients - user reports keep going through
 * api/reports.ts, which has its own deviceId rate limiting and maps into
 * this shape itself. Fails closed: with INGEST_SECRET unset, nothing
 * authenticates.
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.INGEST_SECRET || req.headers['x-ingest-secret'] !== process.env.INGEST_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = NormalizedAlertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid alert payload', issues: parsed.error.issues });
    return;
  }
  const alert = parsed.data;

  try {
    const rows = await sql`
      INSERT INTO alerts (type, location, radius_m, confidence, source, first_seen, expires_at, corroboration_count)
      VALUES (
        ${alert.type},
        ST_SetSRID(ST_MakePoint(${alert.lng}, ${alert.lat}), 4326)::geography,
        ${alert.radius_m},
        ${alert.confidence},
        ${alert.source},
        ${alert.first_seen},
        ${alert.expires_at},
        ${alert.corroboration_count}
      )
      RETURNING
        id,
        type,
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng,
        radius_m,
        confidence,
        source,
        first_seen,
        expires_at,
        corroboration_count
    `;
    const inserted = rows[0] as { id: string } & typeof alert;
    await notifyNewAlert(inserted);
    res.status(201).json(inserted);
  } catch (error) {
    captureException(error);
    console.error('[api/ingest] insert failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withSentry(handler);
