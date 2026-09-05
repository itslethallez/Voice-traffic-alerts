/**
 * "API rate limit hit. Back off exponentially... keep the app alive."
 * Doubles from a 1 minute floor up to a 15 minute ceiling, independent
 * of the normal moving/stationary poll cadence (which a rate limit
 * response overrides while it's in effect).
 */
export const RATE_LIMIT_INITIAL_BACKOFF_MS = 60_000;
export const RATE_LIMIT_MAX_BACKOFF_MS = 15 * 60_000;
export const RATE_LIMIT_BACKOFF_MULTIPLIER = 2;

/** `consecutiveRateLimitHits` is 1 on the first hit, 2 on the second, and so on. */
export function computeRateLimitBackoffMs(consecutiveRateLimitHits: number): number {
  const backoff =
    RATE_LIMIT_INITIAL_BACKOFF_MS * RATE_LIMIT_BACKOFF_MULTIPLIER ** (consecutiveRateLimitHits - 1);
  return Math.min(RATE_LIMIT_MAX_BACKOFF_MS, backoff);
}
