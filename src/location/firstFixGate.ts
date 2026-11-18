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
export class FirstFixGate {
  private waitDeadlineMs: number | null = null;

  constructor(
    private readonly thresholdM: number,
    private readonly waitBudgetMs: number
  ) {}

  isUsable(fix: RawFix, nowMs: number): boolean {
    if (!hasValidCoordinates(fix)) return false;
    if (isAccurateEnough(fix.accuracy, this.thresholdM)) return true;

    if (this.waitDeadlineMs === null) {
      this.waitDeadlineMs = nowMs + this.waitBudgetMs;
    }
    return nowMs >= this.waitDeadlineMs;
  }
}
