import type { MapboxRouteStep } from '../api/mapbox/types';
import { haversineDistance } from '../geo/distance';
import type { GeoPoint } from '../geo/types';

/** Within this many metres of a maneuver's location, treat it as passed
 * and advance to the next step - GPS accuracy at driving speed is rarely
 * tighter than this, so anything smaller risks never firing at all. */
export const STEP_ARRIVAL_THRESHOLD_M = 25;

export interface StepProgress {
  /** Index into `steps` of the step the driver is currently travelling
   * along - the maneuver still to come is steps[currentStepIndex + 1]. */
  currentStepIndex: number;
  /** Distance to the next maneuver - or, once hasArrived, to the
   * destination itself (the final step has no maneuver after it). */
  distanceToNextManeuverM: number;
  /** Distance to the next maneuver plus every full later step's distance -
   * an approximation (the current step's remaining distance isn't
   * projected onto its own geometry, just measured straight to its end),
   * close enough for an ETA display without needing per-step polyline math. */
  remainingDistanceM: number;
  hasArrived: boolean;
}

function stepTargetLocation(step: MapboxRouteStep): GeoPoint {
  return { latitude: step.maneuver.location[1], longitude: step.maneuver.location[0] };
}

/**
 * Advances `previousStepIndex` forward - never backward, so a noisy GPS
 * fix near a maneuver can't bounce it back to a step already passed -
 * based on how close the driver now is to the upcoming maneuver.
 * `steps` is one route's full, in-order step list; Mapbox's final step is
 * always an "arrive" step with no maneuver after it.
 */
export function computeStepProgress(
  driverPosition: GeoPoint,
  steps: readonly MapboxRouteStep[],
  previousStepIndex: number
): StepProgress {
  if (steps.length === 0) {
    return { currentStepIndex: 0, distanceToNextManeuverM: 0, remainingDistanceM: 0, hasArrived: true };
  }

  let currentStepIndex = Math.min(Math.max(previousStepIndex, 0), steps.length - 1);

  // A loop, not a single check, so a low update rate (or a cluster of very
  // short steps) can't leave the index stuck behind where the driver
  // actually is.
  while (currentStepIndex < steps.length - 1) {
    const nextManeuver = stepTargetLocation(steps[currentStepIndex + 1]);
    if (haversineDistance(driverPosition, nextManeuver) > STEP_ARRIVAL_THRESHOLD_M) break;
    currentStepIndex += 1;
  }

  const hasArrived = currentStepIndex >= steps.length - 1;
  const distanceToNextManeuverM = hasArrived
    ? haversineDistance(driverPosition, stepTargetLocation(steps[steps.length - 1]))
    : haversineDistance(driverPosition, stepTargetLocation(steps[currentStepIndex + 1]));

  // steps[currentStepIndex + 1].distance is the length of travel *from*
  // the upcoming maneuver onward to the one after it - not covered by
  // distanceToNextManeuverM above (which only measures up to that
  // maneuver's location), so it has to be included starting there, not
  // one step later.
  const laterStepsDistanceM = hasArrived
    ? 0
    : steps.slice(currentStepIndex + 1).reduce((total, step) => total + step.distance, 0);

  return {
    currentStepIndex,
    distanceToNextManeuverM,
    remainingDistanceM: hasArrived ? 0 : distanceToNextManeuverM + laterStepsDistanceM,
    hasArrived,
  };
}
