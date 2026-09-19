import { z } from 'zod';

/**
 * The single normalized alert shape every ingestion source maps into.
 * Validated with NormalizedAlertSchema at each ingestion boundary
 * (crowd API fetch, police notice parse, fixed-camera DB row, Facebook
 * agent output, user report POST) so a malformed payload from any one
 * source can never reach the alert engine as a partially-valid object.
 *
 * Lives in /shared (outside src/ and server/) because both the Expo app
 * and the Vercel API import it - keep it dependency-free except for zod,
 * which both package.json files declare.
 */

export const AlertTypeSchema = z.enum([
  // A live/reported sighting (crowd_api, user_report, fb_agent) -
  // scheduled enforcement has its own types below, not this one.
  'police',
  // A published mobile-camera notice (police_notice source) - the
  // camera is planned for a window, not confirmed standing there now.
  'mobile_camera',
  // Permanent camera infrastructure (fixed_db source).
  'fixed_camera',
  'traffic',
  'accident',
  'closure',
  'roadkill',
  'hazard',
]);

export const AlertSourceSchema = z.enum([
  'crowd_api',
  'police_notice',
  'fixed_db',
  'fb_agent',
  'user_report',
]);

/** Sources that re-publish the same underlying item on a schedule and
 * therefore get to send a deterministic id for upsert-on-conflict.
 * user_report and fb_agent are deliberately excluded: those rows are
 * one-shot events whose ids must stay untargetable - a caller-supplied
 * id on either is refused at validation before it can reach the
 * ON CONFLICT path. */
const IDEMPOTENT_SOURCES: readonly AlertSource[] = ['crowd_api', 'police_notice', 'fixed_db'];

export const NormalizedAlertSchema = z
  .object({
    /** Optional caller-supplied UUID. Sources that re-publish the same
     * underlying item on every run (e.g. a nightly police-notice scrape
     * whose target stays listed for days) send a deterministic id derived
     * from the item's identity, so POST /api/ingest can upsert instead of
     * stacking duplicate rows; when absent, Postgres generates one. */
    id: z.uuid().optional(),
    type: AlertTypeSchema,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    /** How far from lat/lng the alert applies, in metres. 0 is a pure point. */
    radius_m: z.number().nonnegative(),
    /** Source-reported confidence, normalised to a 0-100 scale. */
    confidence: z.number().min(0).max(100),
    source: AlertSourceSchema,
    /** ISO 8601 timestamps; offset forms are accepted, producers should emit UTC. */
    first_seen: z.iso.datetime(),
    expires_at: z.iso.datetime(),
    corroboration_count: z.number().int().nonnegative(),
  })
  .refine((alert) => alert.id === undefined || IDEMPOTENT_SOURCES.includes(alert.source), {
    message: `caller-supplied id is only allowed for re-publishable sources (${IDEMPOTENT_SOURCES.join(', ')})`,
    path: ['id'],
  });

export type AlertType = z.infer<typeof AlertTypeSchema>;
export type AlertSource = z.infer<typeof AlertSourceSchema>;
export type NormalizedAlert = z.infer<typeof NormalizedAlertSchema>;
