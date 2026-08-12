/**
 * Pinned announce-eligibility thresholds, shared by geo tests here and by
 * the Step 4 filtering engine. These are decided once, here, with the
 * inclusivity explicit and tested at the boundary - Step 4 imports these
 * rather than re-deciding them.
 */
export const ANNOUNCE_MIN_DISTANCE_M = 300;
export const ANNOUNCE_MAX_DISTANCE_M = 2000;
export const ANNOUNCE_MAX_BEARING_DIFF_DEG = 45;
export const ANNOUNCE_MAX_AGE_MINUTES = 30;

/** 300m and 2000m are both inclusive. */
export function isDistanceAnnounceable(distanceMeters: number): boolean {
  return distanceMeters >= ANNOUNCE_MIN_DISTANCE_M && distanceMeters <= ANNOUNCE_MAX_DISTANCE_M;
}

/** 45 degrees is inclusive. */
export function isBearingAnnounceable(bearingDiffDeg: number): boolean {
  return bearingDiffDeg <= ANNOUNCE_MAX_BEARING_DIFF_DEG;
}

/** 30 minutes is exclusive - the report must be strictly under 30 minutes old. */
export function isFreshEnoughToAnnounce(ageMinutes: number): boolean {
  return ageMinutes < ANNOUNCE_MAX_AGE_MINUTES;
}
