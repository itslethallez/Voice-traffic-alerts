import { neon } from '@neondatabase/serverless';

/**
 * HTTP-based driver (not a pooled TCP connection) - matches Vercel
 * Functions' one-shot execution model, where a long-lived pool would just
 * mean a new pool per invocation anyway. DATABASE_URL is set as a Vercel
 * project env var (via `vercel install neon` or pasted from a Neon
 * project's dashboard) and is never exposed to the Expo app.
 */
export const sql = neon(process.env.DATABASE_URL!);
