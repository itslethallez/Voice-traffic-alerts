export interface RawFix {
  latitude: number;
  longitude: number;
  /** expo-location's own shape: metres, or null/undefined when unavailable. */
  accuracy: number | null | undefined;
}

export function hasValidCoordinates(fix: RawFix): boolean {
  return (
    Number.isFinite(fix.latitude) &&
    Number.isFinite(fix.longitude) &&
    Math.abs(fix.latitude) <= 90 &&
    Math.abs(fix.longitude) <= 180
  );
}

export function isAccurateEnough(accuracy: number | null | undefined, thresholdM: number): boolean {
  // Can't judge quality when the platform doesn't report one - accept it.
  return accuracy == null || accuracy <= thresholdM;
}

/**
 * Decides whether a location fix is usable to start the cold-start
 * briefing. Requires valid coordinates always. If accuracy is reported
 * and worse than `thresholdM`, holds out for up to `waitBudgetMs` in case
 * a tighter fix follows shortly after (common right after a cold GPS
 * start) - stateful across calls so it remembers when it first started
 * waiting - but never blocks indefinitely: once the budget elapses, the
 * next fix is accepted regardless of its accuracy.
 */
/** A first fix older than this is a cached position, not where the car
 * is: the screen-off cold-start drive tests were handed the previous
 * position (19s old and 3.3km away on the second run) and briefed the
 * wrong suburbs. 10s is ~220m at 80km/h - close enough to brief from.
 * Never accepted, however long the accuracy wait has run. */
export const FIRST_FIX_MAX_AGE_MS = 10_000;

export class FirstFixGate {
  private waitDeadlineMs: number | null = null;

  constructor(
    private readonly thresholdM: number,
    private readonly waitBudgetMs: number,
    private readonly maxAgeMs: number = FIRST_FIX_MAX_AGE_MS
  ) {}

  /** `fixTimeMs` is when the fix was taken (expo-location's timestamp);
   * omitted means "now". */
  isStale(nowMs: number, fixTimeMs?: number): boolean {
    return fixTimeMs !== undefined && nowMs - fixTimeMs > this.maxAgeMs;
  }

  isUsable(fix: RawFix, nowMs: number, fixTimeMs?: number): boolean {
    if (!hasValidCoordinates(fix)) return false;
    if (this.isStale(nowMs, fixTimeMs)) return false;
    if (isAccurateEnough(fix.accuracy, this.thresholdM)) return true;

    if (this.waitDeadlineMs === null) {
      this.waitDeadlineMs = nowMs + this.waitBudgetMs;
    }
    return nowMs >= this.waitDeadlineMs;
  }
}
