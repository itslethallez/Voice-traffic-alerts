import { haversineDistance } from '../geo/distance';
import type { GeoPoint } from '../geo/types';
import { PAUSE_AFTER_NO_MOVEMENT_MS, SIGNIFICANT_MOVEMENT_THRESHOLD_M } from './constants';
import type { MovementState } from './types';

export const initialMovementState: MovementState = {
  lastPosition: null,
  lastChangedAtMs: null,
};

/** Pure reducer: feed it each new position sample, get back the updated tracker. */
export function updateMovementState(
  prev: MovementState,
  position: GeoPoint,
  nowMs: number
): MovementState {
  if (
    prev.lastPosition === null ||
    haversineDistance(prev.lastPosition, position) > SIGNIFICANT_MOVEMENT_THRESHOLD_M
  ) {
    return { lastPosition: position, lastChangedAtMs: nowMs };
  }
  return prev;
}

/** True once there has been no significant location change for PAUSE_AFTER_NO_MOVEMENT_MS. */
export function isPausedForNoMovement(state: MovementState, nowMs: number): boolean {
  if (state.lastChangedAtMs === null) return false;
  return nowMs - state.lastChangedAtMs >= PAUSE_AFTER_NO_MOVEMENT_MS;
}
