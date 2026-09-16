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
  'police',
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

export const NormalizedAlertSchema = z.object({
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
});

export type AlertType = z.infer<typeof AlertTypeSchema>;
export type AlertSource = z.infer<typeof AlertSourceSchema>;
export type NormalizedAlert = z.infer<typeof NormalizedAlertSchema>;
