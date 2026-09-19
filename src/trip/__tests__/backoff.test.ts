import {
  computeRateLimitBackoffMs,
  RATE_LIMIT_INITIAL_BACKOFF_MS,
  RATE_LIMIT_MAX_BACKOFF_MS,
} from '../backoff';

describe('computeRateLimitBackoffMs', () => {
  it('starts at the initial backoff on the first hit', () => {
    expect(computeRateLimitBackoffMs(1)).toBe(RATE_LIMIT_INITIAL_BACKOFF_MS);
  });

  it('doubles on each consecutive hit', () => {
    expect(computeRateLimitBackoffMs(2)).toBe(RATE_LIMIT_INITIAL_BACKOFF_MS * 2);
    expect(computeRateLimitBackoffMs(3)).toBe(RATE_LIMIT_INITIAL_BACKOFF_MS * 4);
  });

  it('caps at the maximum backoff', () => {
    expect(computeRateLimitBackoffMs(20)).toBe(RATE_LIMIT_MAX_BACKOFF_MS);
  });
});
