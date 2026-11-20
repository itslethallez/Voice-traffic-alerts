import type { GeoPoint } from '../geo/types';
import type { WazeAlert } from '../api/waze/types';

export interface DriverState {
  position: GeoPoint;
  headingDeg: number;
  speedKmh: number;
  /** false when headingDeg is a placeholder - the first fix of a trip with
   * no GPS course and nothing to derive one from (location/toDriverState.ts
   * falls back to 0 = north). Nothing may be called "ahead" off a
   * placeholder heading. Omitted means reliable (older callers, tests). */
  headingReliable?: boolean;
}

/** ahead or onRoad - the two verdicts that carry an along-road distance. */
export function isOnDriversRoad(
  road: RoadContext | null | undefined
): road is Extract<RoadContext, { kind: 'ahead' | 'onRoad' }> {
  return road?.kind === 'ahead' || road?.kind === 'onRoad';
}

/**
 * Where an alert sits relative to the road the driver is on - decided by
 * road/roadContextRuntime.ts from a Mapbox forward route.
 *
 * - ahead: on the driver's road or its continuation, with no turn off it
 *   in between - the only case Shotgun may say "ahead". Distance is along
 *   the road.
 * - nearby: reachable, but not on this road (or not confidently): "nearby,
 *   X away", straight-line distance, never "ahead".
 * - behind: behind the driver or only reachable with a U-turn - silent.
 */
export type RoadContext =
  | { kind: 'ahead'; roadName: string | null; alongRoadMeters: number }
  /** On the driver's road, but Mapbox put it on the other carriageway (it
   * needs a U-turn to reach). Waze reports carry no direction, so which
   * side it's really on is unknown: spoken as "on {road}, X" with no side
   * and no "ahead" (21 Nov 2026 decision). Distance is along the driver's
   * carriageway to the point level with it. */
  | { kind: 'onRoad'; roadName: string; alongRoadMeters: number }
  | { kind: 'nearby' }
  | { kind: 'behind' };

export interface AnnounceableAlert {
  alert: WazeAlert;
  distanceMeters: number;
  bearingDeg: number;
  bearingDiffDeg: number;
  ageMinutes: number;
  /** Driver's heading at selection time - used for "northbound"/"eastbound" wording. 0 (meaningless) for briefing candidates, which have no driver heading. */
  driverHeadingDeg: number;
  /** Set for live announcements (trip/tripRuntime.ts). Undefined is
   * spoken as "nearby" - never "ahead" without a road check. */
  road?: RoadContext;
}

/**
 * An alert not yet eligible to announce, but closing on the point where it
 * will be: the warn radius, or for one already announced, the
 * REMINDER_MIN_CLOSER_METERS reminder threshold. Found by
 * selectApproachingAlerts.ts; consumed by speech/predictAnnouncement.ts.
 */
export interface ApproachingAlert {
  candidate: AnnounceableAlert;
  /** It becomes eligible once its distance is at or below this. */
  entryDistanceMeters: number;
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
