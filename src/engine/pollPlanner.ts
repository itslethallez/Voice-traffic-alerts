import { boundingBox } from '../geo/boundingBox';
import { radiusBoundingBox } from '../geo/radiusBoundingBox';
import {
  MOVING_BOX_AHEAD_M,
  MOVING_BOX_SIDE_M,
  MOVING_POLL_INTERVAL_MS,
  STATIONARY_BOX_RADIUS_M,
  STATIONARY_POLL_INTERVAL_MS,
  STATIONARY_SPEED_THRESHOLD_KMH,
} from './constants';
import { isPausedForNoMovement } from './movement';
import type { DriverState, MovementState, PollPlan } from './types';

/** side/ahead stays proportional to MOVING_BOX_AHEAD_M/MOVING_BOX_SIDE_M's
 * original ratio when the box grows to cover a wider announce distance. */
const MOVING_BOX_SIDE_RATIO = MOVING_BOX_SIDE_M / MOVING_BOX_AHEAD_M;

/**
 * Pure decision function for a single polling tick: whether to poll at
 * all, how long until the next attempt, and (when polling) which
 * bounding box to query. No I/O here - the actual fetch/timer wiring
 * happens where this is called from (Step 8/9).
 *
 * `announceDistanceMeters` is the user's live-announcement distance
 * setting (Settings screen) - the fetch box must cover at least that far,
 * or alerts beyond it would never even reach the cache for
 * selectAnnounceableAlerts to consider. The MOVING_BOX_ and
 * STATIONARY_BOX_ constants are used as a floor, not a ceiling, so the
 * default setting gets exactly the previous fixed-size box - this only
 * grows the box for drivers who've raised the setting above what those
 * constants cover.
 */
export function planPoll(
  driver: DriverState,
  movement: MovementState,
  nowMs: number,
  announceDistanceMeters: number
): PollPlan {
  if (isPausedForNoMovement(movement, nowMs)) {
    return {
      shouldPoll: false,
      intervalMs: STATIONARY_POLL_INTERVAL_MS,
      boundingBox: null,
      reason: 'paused',
    };
  }

  const isMoving = driver.speedKmh >= STATIONARY_SPEED_THRESHOLD_KMH;

  if (isMoving) {
    const aheadM = Math.max(MOVING_BOX_AHEAD_M, announceDistanceMeters);
    const sideM = Math.round(aheadM * MOVING_BOX_SIDE_RATIO);
    return {
      shouldPoll: true,
      intervalMs: MOVING_POLL_INTERVAL_MS,
      boundingBox: boundingBox(driver.position, driver.headingDeg, aheadM, sideM),
      reason: 'moving',
    };
  }

  return {
    shouldPoll: true,
    intervalMs: STATIONARY_POLL_INTERVAL_MS,
    boundingBox: radiusBoundingBox(
      driver.position,
      Math.max(STATIONARY_BOX_RADIUS_M, announceDistanceMeters)
    ),
    reason: 'stationary',
  };
}
