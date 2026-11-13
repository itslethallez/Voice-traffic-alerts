import type { AlertType } from '../../shared/alert-schema';
import { sql } from './db';

/**
 * Half the forward corridor cone, in degrees: ±60° about the driver's
 * heading counts as "ahead". Deliberately wider than the 45° announce
 * window (src/geo/announceWindow.ts) — this is a fetch/display corridor,
 * not a speak trigger, so it should see alerts on a road that bends ahead
 * or sits just past a junction, not only dead-on-heading ones.
 */
export const CORRIDOR_HALF_ANGLE_DEG = 60;

/**
 * Alerts whose *edge* is this close are corridor-relevant regardless of
 * bearing: at a few hundred metres an alert is effectively "here" (a
 * junction turn, a roundabout, GPS heading noise at crawl speed), and
 * dropping it for being 61° off heading would hide the thing the driver
 * is about to reach.
 */
export const CORRIDOR_ALWAYS_NEARBY_M = 400;

/** Hard cap on one corridor fetch — the 15–30s foreground poll never needs
 * more than this, and it bounds the response the Redis cache stores. */
export const CORRIDOR_MAX_RESULTS = 100;

/**
 * Facebook-agent rows are never published below this confidence. The
 * human-in-the-loop rule (.windsurfrules — all Facebook-derived alerts
 * require review until explicitly told otherwise) has no reviewed flag on
 * the schema yet, so confidence is the only gate the query can enforce.
 * Enforced here, inside the shared spatial helper, rather than in the
 * endpoint — a publication gate has to hold for every reader, not just
 * one caller.
 *
 * TODO(phase-3): this threshold is a stopgap, not the mechanism — a
 * confidence number is not a human approval. When the review dashboard
 * starts marking alerts, add a real reviewed_at column and swap the gate
 * to `a.reviewed_at IS NOT NULL`. Tracked in
 * https://github.com/itslethallez/Voice-traffic-alerts/issues/2
 */
export const FB_AGENT_PUBLISH_MIN_CONFIDENCE = 80;

export interface CorridorQueryParams {
  lat: number;
  lng: number;
  /** Driver heading in degrees clockwise from north. null (stationary or
   * unknown — GPS heading is meaningless below a few km/h) degrades the
   * corridor to a plain radius: there is no "ahead" without a direction
   * of travel. */
  headingDeg: number | null;
  /** Corridor reach in metres — how far ahead/nearby to look. */
  radiusMeters: number;
  /** Normalized types to include (the caller's enabled categories). An
   * empty array short-circuits to no rows — a caller that filtered out
   * every category needs no query at all. */
  types: readonly AlertType[];
  limit?: number;
}

/**
 * One corridor-relevant alert row: the normalized alert columns (matching
 * shared/alert-schema.ts / the `alerts` table field-for-field) plus the
 * driver's distance and bearing to it, which the client needs for the
 * nearby list's distance sort and "ahead" wording.
 */
export interface CorridorAlertRow {
  id: string;
  type: AlertType;
  lat: number;
  lng: number;
  radius_m: number;
  confidence: number;
  source: string;
  first_seen: string;
  expires_at: string;
  corroboration_count: number;
  distance_m: number;
  bearing_deg: number;
}

/**
 * The corridor-relevance query behind GET /api/alerts/nearby: alerts within
 * `radiusMeters` of the driver (measured to each alert's own edge — an
 * alert's `radius_m` widens its footprint, so a 2 km closure counts when
 * its edge enters the corridor, not only when its centre does) AND inside
 * a ±CORRIDOR_HALF_ANGLE_DEG cone about the heading — "a corridor buffer
 * ahead of travel direction", not just the exact road. Anything whose edge
 * is within CORRIDOR_ALWAYS_NEARBY_M is kept regardless of bearing (see the
 * constant's comment). With headingDeg null the cone clause is skipped
 * entirely and the result is a plain radius.
 *
 * Publication gate: fb_agent rows below FB_AGENT_PUBLISH_MIN_CONFIDENCE are
 * excluded in SQL regardless of which types the caller asks for — a client
 * cannot widen this by passing every category.
 *
 * Bearing math: ST_Azimuth over the geography points gives the north-based
 * azimuth in radians (PostGIS ≥2.2 semantics); degrees() then `mod(x+360,
 * 360)` normalizes it to 0–360 regardless of the signed range the version
 * returns. The bearing difference is the standard circular one —
 * `abs(mod(b - h + 540, 360) - 180)` — yielding 0–180°. `mod` is called on
 * numerics (double → numeric cast) so it behaves identically on every
 * supported Postgres version.
 *
 * Ordering is nearest-edge-first so the nearby-alerts list reads closest →
 * furthest, matching the mockup's "5 alerts nearby" sheet.
 */
export async function selectCorridorAlerts(params: CorridorQueryParams): Promise<CorridorAlertRow[]> {
  const { lat, lng, headingDeg, radiusMeters, types } = params;
  const limit = Math.min(params.limit ?? CORRIDOR_MAX_RESULTS, CORRIDOR_MAX_RESULTS);

  if (types.length === 0) return [];

  const rows = await sql`
    WITH driver AS (
      SELECT ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography AS pos
    ),
    nearby AS (
      SELECT
        a.id,
        a.type,
        ST_Y(a.location::geometry) AS lat,
        ST_X(a.location::geometry) AS lng,
        a.radius_m,
        a.confidence,
        a.source,
        a.first_seen,
        a.expires_at,
        a.corroboration_count,
        ST_Distance(a.location, d.pos) AS distance_m,
        mod(
          degrees(ST_Azimuth(d.pos::geometry, a.location::geometry))::numeric + 360,
          360
        )::float8 AS bearing_deg
      FROM alerts a, driver d
      WHERE a.expires_at > now()
        AND (a.source <> 'fb_agent' OR a.confidence >= ${FB_AGENT_PUBLISH_MIN_CONFIDENCE})
        AND a.type = ANY(${types}::text[])
        AND ST_DWithin(a.location, d.pos, ${radiusMeters} + a.radius_m)
    )
    SELECT nearby.*
    FROM nearby
    WHERE ${headingDeg}::numeric IS NULL
       OR abs(mod(nearby.bearing_deg::numeric - ${headingDeg}::numeric + 540, 360) - 180) <= ${CORRIDOR_HALF_ANGLE_DEG}
       OR (nearby.distance_m - nearby.radius_m) <= ${CORRIDOR_ALWAYS_NEARBY_M}
    ORDER BY (nearby.distance_m - nearby.radius_m)
    LIMIT ${limit}
  `;

  return rows as CorridorAlertRow[];
}
