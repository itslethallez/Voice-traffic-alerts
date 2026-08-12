import type { GeoPoint } from '../geo/types';
import type { WazeAlert } from '../api/waze/types';

export interface DriverState {
  position: GeoPoint;
  headingDeg: number;
  speedKmh: number;
}

export interface AnnounceableAlert {
  alert: WazeAlert;
  distanceMeters: number;
  bearingDeg: number;
  bearingDiffDeg: number;
  ageMinutes: number;
}

export interface MovementState {
  lastPosition: GeoPoint | null;
  /** ms epoch of the last time the position changed by more than a GPS-noise-sized amount. */
  lastChangedAtMs: number | null;
}

export interface SpeedState {
  /** ms epoch of when speed first dropped below MIN_SUSTAINED_SPEED_KMH, or null if at/above it now. */
  belowThresholdSinceMs: number | null;
}

export interface AlertsCache {
  alerts: WazeAlert[];
  fetchedAtMs: number | null;
  /** true once a fetch has failed and we're serving a previous response instead. */
  isStale: boolean;
}

export type PollReason = 'moving' | 'stationary' | 'paused';

export interface PollPlan {
  shouldPoll: boolean;
  intervalMs: number;
  boundingBox: { bottom_left: string; top_right: string } | null;
  reason: PollReason;
}
