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

/**
 * Pure decision function for a single polling tick: whether to poll at
 * all, how long until the next attempt, and (when polling) which
 * bounding box to query. No I/O here - the actual fetch/timer wiring
 * happens where this is called from (Step 8/9).
 */
export function planPoll(driver: DriverState, movement: MovementState, nowMs: number): PollPlan {
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
    return {
      shouldPoll: true,
      intervalMs: MOVING_POLL_INTERVAL_MS,
      boundingBox: boundingBox(driver.position, driver.headingDeg, MOVING_BOX_AHEAD_M, MOVING_BOX_SIDE_M),
      reason: 'moving',
    };
  }

  return {
    shouldPoll: true,
    intervalMs: STATIONARY_POLL_INTERVAL_MS,
    boundingBox: radiusBoundingBox(driver.position, STATIONARY_BOX_RADIUS_M),
    reason: 'stationary',
  };
}
