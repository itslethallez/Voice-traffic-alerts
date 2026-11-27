import type { WazeAlert } from '../api/waze/types';
import type { FixedSpeedCamera } from '../data/fixedSpeedCameras';
import { bearingBetween, bearingDifference } from '../geo/bearing';
import { isBearingAnnounceable, isFreshEnoughToAnnounce } from '../geo/announceWindow';
import { haversineDistance } from '../geo/distance';
import { distanceToPolyline } from '../geo/routePolyline';
import type { GeoPoint } from '../geo/types';
import type { RouteCorridor } from './selectAlerts';
import { isOnDriversRoad, type DriverState, type RoadContext } from './types';
import { roadNamesIn } from '../road/roadNames';

export type WarningTargetKind = 'camera' | 'report';

export interface WarningTarget {
  id: string;
  kind: WarningTargetKind;
  position: GeoPoint;
  /** Road name(s) for road matching: both roads of a SAPOL camera
   * intersection label, or the police report's street. */
  streets: string[];
}

/** Road matching's answer for a target (road/roadContextRuntime.ts), or
 * 'pending' while it's still being looked up. */
export type WarningRoadLookup = (target: WarningTarget) => RoadContext | 'pending';

/** Distance used against the 500m/200m checkpoints: along the road when
 * road matching confirmed the target is ahead on it, else straight-line. */
function warningDistance(driver: DriverState, target: WarningTarget, road: RoadContext | null): number {
  return isOnDriversRoad(road) ? road.alongRoadMeters : haversineDistance(driver.position, target.position);
}

/**
 * Road matching's answer for a target - asked only for targets within the
 * outer checkpoint in a straight line. Road distance is never shorter than
 * straight-line, so nothing further out can reach a checkpoint; asking
 * about every camera in the state cost one Mapbox request each (the first
 * Stage 3 drive test burned the hourly lookup budget in under 4 minutes on
 * cameras up to 280km away). Lookups further out, to have the answer in
 * before 500m, are made by trip/tripRuntime.ts within the camera radius.
 */
function roadIfInRange(
  driver: DriverState,
  target: WarningTarget,
  roadFor: WarningRoadLookup | undefined
): RoadContext | null {
  if (!roadFor) return null;
  if (haversineDistance(driver.position, target.position) > SPEED_WARNING_CHECKPOINTS_M[0]) return null;
  const answer = roadFor(target);
  return answer === 'pending' ? null : answer;
}

/** Farthest first - see selectSpeedCameraWarning's doc comment for the
 * firing-order rule this ordering drives. */
export const SPEED_WARNING_CHECKPOINTS_M = [500, 200] as const;
export type SpeedWarningCheckpoint = (typeof SPEED_WARNING_CHECKPOINTS_M)[number];

/** Confirmed buffer: warn once the driver is at least this many km/h over
 * the posted limit. */
export const SPEED_WARNING_BUFFER_KMH = 6;

/** A police report counts as "corroborated" if it clears either bar - at
 * least one other driver thumbed it up, or Waze's own reliability score
 * already reads Medium-or-better (matches theme/confidence.ts's existing
 * banding). We only ever read alerts as Waze already published them - see
 * ManualReport's doc comment in store/useTripStore.ts - so these are the
 * only two corroboration signals actually available to us. */
const CORROBORATION_MIN_THUMBS_UP = 1;
const CORROBORATION_MIN_RELIABILITY = 4;

function isCorroboratedPoliceReport(alert: WazeAlert): boolean {
  return (
    alert.type === 'POLICE' &&
    (alert.num_thumbs_up >= CORROBORATION_MIN_THUMBS_UP || alert.alert_reliability >= CORROBORATION_MIN_RELIABILITY)
  );
}

export function gatherTargets(cameras: FixedSpeedCamera[], alerts: WazeAlert[]): WarningTarget[] {
  const cameraTargets: WarningTarget[] = cameras.map((camera) => ({
    id: camera.id,
    kind: 'camera',
    position: camera.position,
    streets: roadNamesIn(camera.label),
  }));
  const reportTargets: WarningTarget[] = alerts.filter(isCorroboratedPoliceReport).map((alert) => ({
    id: alert.alert_id,
    kind: 'report',
    position: { latitude: alert.latitude, longitude: alert.longitude },
    streets: alert.street ? [alert.street] : [],
  }));
  return [...cameraTargets, ...reportTargets];
}

/**
 * A target is geometrically eligible if it's ahead of the driver (reusing
 * the existing 45-degree announce cone) and within the outer checkpoint
 * (500m) - deliberately NOT geo/announceWindow.ts's isDistanceAnnounceable,
 * whose 300m floor exists for a different feature and would wrongly
 * exclude this feature's own 200m checkpoint. A corroborated report must
 * also still be fresh (the existing 30-minute announce-window freshness
 * check) - a camera has no such check, since it's permanent infrastructure.
 *
 * In nav mode (routeCorridor set) the bearing cone is replaced by
 * proximity to the remaining route - same substitution
 * selectAnnounceableAlerts makes for hazard announcements - so a camera
 * or police report on a nearby-but-off-route street doesn't warn
 * mid-navigation. The 500m outer checkpoint still applies on top.
 */
function isGeometricallyEligible(
  driver: DriverState,
  target: WarningTarget,
  alerts: WazeAlert[],
  nowMs: number,
  routeCorridor: RouteCorridor | undefined,
  road: RoadContext | null = null
): boolean {
  if (road?.kind === 'behind') return false;
  // A camera on a road the driver isn't on is silent (21 Nov 2026, case F).
  // Only when the route confirmed it - an unknown road still warns.
  if (target.kind === 'camera' && road?.kind === 'nearby' && road.offRoad) return false;
  const distanceMeters = warningDistance(driver, target, road);
  const outerCheckpoint = SPEED_WARNING_CHECKPOINTS_M[0];
  if (distanceMeters > outerCheckpoint) return false;

  if (isOnDriversRoad(road)) {
    // Confirmed on the driver's road: the heading cone doesn't apply (a
    // bend can put a camera on your own road well off your heading).
  } else if (routeCorridor) {
    if (distanceToPolyline(target.position, routeCorridor.polyline) > routeCorridor.corridorMeters) {
      return false;
    }
  } else {
    const bearingDeg = bearingBetween(driver.position, target.position);
    const bearingDiffDeg = bearingDifference(driver.headingDeg, bearingDeg);
    if (!isBearingAnnounceable(bearingDiffDeg)) return false;
  }

  if (target.kind === 'report') {
    const alert = alerts.find((a) => a.alert_id === target.id);
    if (!alert) return false;
    const ageMinutes = (nowMs - Date.parse(alert.publish_datetime_utc)) / 60_000;
    if (!isFreshEnoughToAnnounce(ageMinutes)) return false;
  }

  return true;
}

/**
 * Cheap sync pre-check - no speed limit needed. Lets tripRuntime.ts decide
 * whether it's worth prefetching a speed limit at all (most of a trip has
 * no nearby camera or corroborated report, so this keeps the Overpass
 * lookup rare rather than continuous).
 */
export function hasNearbyWarningTarget(
  driver: DriverState,
  cameras: FixedSpeedCamera[],
  alerts: WazeAlert[],
  nowMs: number,
  routeCorridor?: RouteCorridor,
  roadFor?: WarningRoadLookup
): boolean {
  return gatherTargets(cameras, alerts).some((target) =>
    isGeometricallyEligible(driver, target, alerts, nowMs, routeCorridor, roadIfInRange(driver, target, roadFor))
  );
}

export interface SelectSpeedCameraWarningInput {
  driver: DriverState;
  /** Resolved OSM maxspeed for the driver's current position - null if
   * unresolved (not yet prefetched, or genuinely unavailable there). */
  speedLimitKmh: number | null;
  cameras: FixedSpeedCamera[];
  alerts: WazeAlert[];
  /** Which checkpoints have already fired for which target id this trip. */
  firedCheckpoints: ReadonlyMap<string, ReadonlySet<SpeedWarningCheckpoint>>;
  nowMs: number;
  /** Nav mode only: proximity to the remaining route replaces the
   * bearing-of-travel cone - see isGeometricallyEligible. */
  routeCorridor?: RouteCorridor;
  /** Road matching. Omitted: every target is treated as unconfirmed
   * ("nearby" wording, straight-line distance). */
  roadFor?: WarningRoadLookup;
}

export interface SpeedCameraWarningResult {
  target: WarningTarget;
  checkpoint: SpeedWarningCheckpoint;
  distanceMeters: number;
  /** True when speedLimitKmh was resolved and driver.speedKmh actually
   * cleared it + SPEED_WARNING_BUFFER_KMH - false when the limit is
   * unresolved/unavailable (speedLimitKmh === null), in which case this
   * still fires rather than staying silent just because the lookup
   * failed, but formatSpeedCameraWarning must not claim the driver is
   * confirmed speeding. */
  confirmedSpeeding: boolean;
  /** Road matching's answer - null when unconfirmed (pending / not asked).
   * Only "ahead" may be worded as ahead, or claim the driver is speeding. */
  road: RoadContext | null;
}

/**
 * The full decision. Returns the nearest-target, farthest-unfired-checkpoint
 * match, or null if nothing qualifies. Checkpoints are checked farthest
 * first ([500, 200]) per target: if GPS sampling is sparse enough to jump
 * straight from outside 500m to inside 200m in one update, 500 fires first
 * (slightly "late" but simple and self-correcting - 200 fires on the very
 * next update once 500 is marked fired). Never fires twice for the same
 * (target, checkpoint) pair. When speedLimitKmh is resolved, never fires at
 * all while driver.speedKmh is under speedLimitKmh + SPEED_WARNING_BUFFER_KMH
 * - but an unresolved limit (null - not yet fetched, or genuinely
 * unavailable there, e.g. off the major-road classes roadSpeedLimit.ts
 * queries) does NOT suppress the warning; a driver should still hear
 * "camera ahead" even when this app can't confirm they're over the limit,
 * rather than staying silent because a lookup happened to fail.
 */
export function selectSpeedCameraWarning(input: SelectSpeedCameraWarningInput): SpeedCameraWarningResult | null {
  const { driver, speedLimitKmh, cameras, alerts, firedCheckpoints, nowMs, routeCorridor, roadFor } = input;
  if (speedLimitKmh !== null && driver.speedKmh < speedLimitKmh + SPEED_WARNING_BUFFER_KMH) return null;
  const confirmedSpeeding = speedLimitKmh !== null;

  const targets = gatherTargets(cameras, alerts)
    .map((target) => ({ target, road: roadIfInRange(driver, target, roadFor) }))
    .filter(({ target, road }) => isGeometricallyEligible(driver, target, alerts, nowMs, routeCorridor, road));

  let best: SpeedCameraWarningResult | null = null;
  for (const { target, road } of targets) {
    const distanceMeters = warningDistance(driver, target, road);
    const fired = firedCheckpoints.get(target.id) ?? new Set<SpeedWarningCheckpoint>();

    for (const checkpoint of SPEED_WARNING_CHECKPOINTS_M) {
      if (fired.has(checkpoint)) continue;
      if (distanceMeters > checkpoint) continue;

      if (!best || distanceMeters < best.distanceMeters) {
        best = { target, checkpoint, distanceMeters, confirmedSpeeding, road };
      }
      break; // farthest-first: this is the checkpoint to fire for this target
    }
  }

  return best;
}
