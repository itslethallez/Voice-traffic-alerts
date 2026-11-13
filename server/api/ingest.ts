import type { VercelRequest, VercelResponse } from '../lib/vercel-types';
import { sql } from '../lib/db';
import { withSentry, captureException } from '../lib/sentry';
import { notifyNewAlert } from '../lib/notify';
import {
  AlertSourceSchema,
  NormalizedAlertSchema,
  type AlertSource,
} from '../../shared/alert-schema';

/**
 * The single write path into the `alerts` table: every source (crowd API
 * mirror, police notice scraper, fixed-camera load, Facebook agent, user
 * reports) posts here, and this is where the shared Zod schema is enforced -
 * a payload that fails validation never reaches Postgres.
 *
 * Auth is a per-source shared secret in the x-ingest-secret header: the
 * presented secret is matched against the source -> env-var table below,
 * so a credential proves WHICH source its holder may write. One source's
 * secret can neither inject rows claiming another source nor (via the
 * upsert's WHERE clause) overwrite another source's rows by id. The
 * callers are server-to-server (QStash-triggered jobs, scheduled
 * scripts), not app clients - user reports keep going through
 * api/reports.ts, which has its own deviceId rate limiting and never
 * touches this endpoint. Fails closed: a source with no secret
 * configured accepts nothing. Keep the per-source secrets distinct -
 * if a value were configured for two sources it would resolve to the
 * first match.
 */
const SOURCE_INGEST_SECRET_ENV: Record<AlertSource, string> = {
  crowd_api: 'INGEST_SECRET_CROWD_API',
  police_notice: 'INGEST_SECRET_POLICE_NOTICE',
  fixed_db: 'INGEST_SECRET_FIXED_DB',
  fb_agent: 'INGEST_SECRET_FB_AGENT',
  user_report: 'INGEST_SECRET_USER_REPORT',
};

/** Resolves the presented secret to the single source it authorizes, or
 * null when it matches no configured secret. The secret itself determines
 * identity - there is no claimed-source header for a caller to lie with. */
function resolveIngestSource(header: string | string[] | undefined): AlertSource | null {
  const secret = Array.isArray(header) ? header[0] : header;
  if (!secret) return null;
  for (const source of AlertSourceSchema.options) {
    const expected = process.env[SOURCE_INGEST_SECRET_ENV[source]];
    if (expected && secret === expected) return source;
  }
  return null;
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const callerSource = resolveIngestSource(req.headers['x-ingest-secret']);
  if (!callerSource) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = NormalizedAlertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid alert payload', issues: parsed.error.issues });
    return;
  }
  const alert = parsed.data;

  // The credential proved one source; the payload must be that source.
  // 403, not 401: authentication succeeded, the authorization doesn't
  // cover what was asked for.
  if (alert.source !== callerSource) {
    res.status(403).json({ error: `x-ingest-secret is not authorized for source "${alert.source}"` });
    return;
  }

  try {
    // ON CONFLICT on the PK is what makes caller-supplied deterministic
    // ids useful: a re-scraped notice refreshes the row instead of
    // duplicating it. The WHERE clause confines the update to same-source
    // rows; the 403 check above already guarantees the payload's source
    // is the credential's source, so this is belt-and-suspenders against
    // a future caller that could spoof the body check - without it a
    // conflicting id on another source's row would overwrite it. `xmax
    // = 0` distinguishes the insert path from the conflict-update path
    // so only genuinely new alerts fan out.
    const rows = await sql`
      INSERT INTO alerts (id, type, location, radius_m, confidence, source, first_seen, expires_at, corroboration_count)
      VALUES (
        COALESCE(${alert.id ?? null}::uuid, gen_random_uuid()),
        ${alert.type},
        ST_SetSRID(ST_MakePoint(${alert.lng}, ${alert.lat}), 4326)::geography,
        ${alert.radius_m},
        ${alert.confidence},
        ${alert.source},
        ${alert.first_seen},
        ${alert.expires_at},
        ${alert.corroboration_count}
      )
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        location = EXCLUDED.location,
        radius_m = EXCLUDED.radius_m,
        confidence = EXCLUDED.confidence,
        source = EXCLUDED.source,
        first_seen = EXCLUDED.first_seen,
        expires_at = EXCLUDED.expires_at,
        corroboration_count = EXCLUDED.corroboration_count
      WHERE alerts.source = EXCLUDED.source
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
        corroboration_count,
        (xmax = 0) AS inserted
    `;
    // A conflicting id whose row belongs to a different source hits the
    // ON CONFLICT but fails the WHERE - no row is written and RETURNING
    // yields nothing. That's a refused cross-source overwrite, not a
    // success: say so explicitly.
    if (rows.length === 0) {
      res.status(409).json({ error: 'Alert id belongs to a different source' });
      return;
    }
    const { inserted: isNew, ...row } = rows[0] as { id: string; inserted: boolean } & typeof alert;
    if (isNew) await notifyNewAlert(row);
    res.status(isNew ? 201 : 200).json(row);
  } catch (error) {
    captureException(error);
    console.error('[api/ingest] insert failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withSentry(handler);
