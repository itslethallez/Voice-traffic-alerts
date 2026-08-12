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

/**
 * 300m is a fixed inclusive floor (a physics/safety limit: something this
 * close is too late to be useful, not a preference). The upper bound
 * defaults to the pinned 2000m but accepts an override - Step 7's
 * announcement distance slider (500m-3km) passes its own value through
 * here rather than this function re-deciding the default. Inclusive at
 * whatever the upper bound is.
 */
export function isDistanceAnnounceable(
  distanceMeters: number,
  maxDistanceMeters: number = ANNOUNCE_MAX_DISTANCE_M
): boolean {
  return distanceMeters >= ANNOUNCE_MIN_DISTANCE_M && distanceMeters <= maxDistanceMeters;
}

/** 45 degrees is inclusive. */
export function isBearingAnnounceable(bearingDiffDeg: number): boolean {
  return bearingDiffDeg <= ANNOUNCE_MAX_BEARING_DIFF_DEG;
}

/** 30 minutes is exclusive - the report must be strictly under 30 minutes old. */
export function isFreshEnoughToAnnounce(ageMinutes: number): boolean {
  return ageMinutes < ANNOUNCE_MAX_AGE_MINUTES;
}
