import { MIN_SUSTAINED_SPEED_KMH, SUSTAINED_LOW_SPEED_WINDOW_MS } from './constants';
import type { SpeedState } from './types';

export const initialSpeedState: SpeedState = {
  belowThresholdSinceMs: null,
};

/** Pure reducer: feed it each new speed reading, get back the updated tracker. */
export function updateSpeedState(prev: SpeedState, speedKmh: number, nowMs: number): SpeedState {
  if (speedKmh < MIN_SUSTAINED_SPEED_KMH) {
    return { belowThresholdSinceMs: prev.belowThresholdSinceMs ?? nowMs };
  }
  return { belowThresholdSinceMs: null };
}

/**
 * True once speed has been continuously below MIN_SUSTAINED_SPEED_KMH for
 * SUSTAINED_LOW_SPEED_WINDOW_MS - the "passenger on a train" gate. When
 * true, the app should suppress announcements even if alerts otherwise
 * qualify.
 */
export function isSustainedLowSpeed(state: SpeedState, nowMs: number): boolean {
  if (state.belowThresholdSinceMs === null) return false;
  return nowMs - state.belowThresholdSinceMs >= SUSTAINED_LOW_SPEED_WINDOW_MS;
}
