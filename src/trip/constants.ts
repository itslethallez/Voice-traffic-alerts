/**
 * Cold-start briefing fetch policy: attempt immediately, then retry a
 * handful of times on a short fixed cadence - independent of the normal
 * moving/stationary poll cadence (engine/constants.ts) and the rate-limit
 * backoff (backoff.ts), which are both too slow for a driver waiting on
 * the briefing to start. Stops immediately on any successful fetch,
 * including one that returns zero alerts.
 */
export const BRIEFING_FETCH_RETRY_INTERVAL_MS = 3_000;
export const BRIEFING_MAX_FETCH_ATTEMPTS = 5;

/** Only shown if the briefing is still waiting on its first fetch this long. */
export const BRIEFING_LOADING_BANNER_DELAY_MS = 2_000;
