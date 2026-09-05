import type { WazeAlertType } from '../api/waze/types';

/** Below this speed, treat the driver as stationary for polling/box purposes. */
export const STATIONARY_SPEED_THRESHOLD_KMH = 5;

export const MOVING_POLL_INTERVAL_MS = 45_000;
export const STATIONARY_POLL_INTERVAL_MS = 5 * 60_000;
/** No location change for this long and we stop polling entirely. */
export const PAUSE_AFTER_NO_MOVEMENT_MS = 15 * 60_000;

/**
 * A position sample within this many metres of the last one doesn't count
 * as "the location changed" - it's GPS noise, not movement. This assumes
 * the location provider itself is already configured with a minimum
 * distance interval (wired up in Step 8), so this is just a defensive
 * floor, not the primary jitter filter.
 */
export const SIGNIFICANT_MOVEMENT_THRESHOLD_M = 5;

export const MOVING_BOX_AHEAD_M = 5000;
export const MOVING_BOX_SIDE_M = 1500;
export const STATIONARY_BOX_RADIUS_M = 2000;

/**
 * "Do not announce below 15 km/h sustained" - a passenger/train rider
 * isn't solvable, but momentary slow-downs (a red light, a queue) while
 * actually driving shouldn't fall foul of this. "Sustained" is defined
 * here as 2 continuous minutes below the threshold.
 */
export const MIN_SUSTAINED_SPEED_KMH = 15;
export const SUSTAINED_LOW_SPEED_WINDOW_MS = 2 * 60_000;

/** accident, then road closure, then hazard, then police, then jam. */
export const SEVERITY_ORDER: WazeAlertType[] = [
  'ACCIDENT',
  'ROAD_CLOSED',
  'HAZARD',
  'POLICE',
  'JAM',
];

/** Cold-start briefing: nearest-first list, capped so a dense area doesn't become a monologue. */
export const MAX_BRIEFING_ALERTS = 8;
