import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../lib/db';

/**
 * All fixed cameras, no pagination - SAPOL's own table is under 100 rows
 * (see scripts/buildFixedCameraDataset.js, the ingest job for this table),
 * small enough for one response. Cached at the edge for an hour since this
 * only changes when someone re-runs that script.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const rows = await sql`
      SELECT
        id,
        lat,
        lng,
        road_name AS "roadName",
        camera_type AS "cameraType",
        source,
        last_synced_at AS "lastSyncedAt"
      FROM fixed_cameras
    `;
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json(rows);
  } catch (error) {
    console.error('[api/cameras] query failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
