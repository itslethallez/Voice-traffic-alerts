/**
 * Waze's alert_reliability is a 0-10 scale (undocumented officially, but
 * consistent across the sample data this project has seen - see
 * api/waze/types.ts's header comment for how that data was verified).
 * Bucketed into 3 bands for the Nearby Transmission card - a raw "7/10"
 * reads as an arbitrary score at a glance; "High confidence" doesn't.
 */
export function confidenceLabel(reliability: number): string {
  if (reliability >= 7) return 'High confidence';
  if (reliability >= 4) return 'Medium confidence';
  return 'Low confidence';
}
