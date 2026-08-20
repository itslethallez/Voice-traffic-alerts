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
 * How much closer (in metres) an already-announced alert must have gotten
 * before it's worth interrupting the driver again - "reminders of any
 * updates getting closer" from the spec. Small GPS jitter or a driver
 * briefly slowing down shouldn't retrigger it; a real step closer should.
 */
export const REMINDER_MIN_CLOSER_METERS = 1000;

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

/**
 * Whether a re-announcement is warranted for an alert already announced
 * once at `lastAnnouncedDistanceMeters` - true if the driver has since
 * closed at least REMINDER_MIN_CLOSER_METERS of distance to it.
 */
export function isMeaningfullyCloser(
  distanceMeters: number,
  lastAnnouncedDistanceMeters: number
): boolean {
  return distanceMeters <= lastAnnouncedDistanceMeters - REMINDER_MIN_CLOSER_METERS;
}
