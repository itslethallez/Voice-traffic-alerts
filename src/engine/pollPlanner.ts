import { ANNOUNCE_MAX_BEARING_DIFF_DEG } from '../geo/announceWindow';
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

const MAX_BEARING_DIFF_RAD = (ANNOUNCE_MAX_BEARING_DIFF_DEG * Math.PI) / 180;

/**
 * How far to the side of the heading the box needs to reach so it still
 * encloses every point selectAnnounceableAlerts could accept: an alert up
 * to `announceDistanceMeters` away (the actual per-alert distance cap
 * selectAnnounceableAlerts checks - not the box's own `aheadM`, which is
 * floored higher for polling-cadence reasons unrelated to how far an
 * alert can actually be) and up to ANNOUNCE_MAX_BEARING_DIFF_DEG
 * off-heading can sit `announceDistanceMeters * sin(maxBearingDiff)` to
 * the side. Using the floored aheadM here instead would demand more side
 * coverage than any accepted alert could ever need, growing the box (and
 * therefore every moving poll's chance of hitting the 200-alert cap and
 * triggering quadrant splits) for no benefit at the default setting.
 */
function requiredSideM(announceDistanceMeters: number): number {
  return Math.max(MOVING_BOX_SIDE_M, Math.ceil(announceDistanceMeters * Math.sin(MAX_BEARING_DIFF_RAD)));
}

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
    const sideM = requiredSideM(announceDistanceMeters);
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
