import type { MapboxRouteStep } from '../api/mapbox/types';
import { haversineDistance } from '../geo/distance';
import type { GeoPoint } from '../geo/types';

/** Within this many metres of a maneuver's location, treat it as passed
 * and advance to the next step - GPS accuracy at driving speed is rarely
 * tighter than this, so anything smaller risks never firing at all. */
export const STEP_ARRIVAL_THRESHOLD_M = 25;

/** How many steps past the current one a fix may be projected onto. A
 * 3s foreground fix at speed can skip a short step or two; a bounded
 * window keeps a parallel or looping later stretch of the route from
 * stealing the projection. */
const PROJECTION_LOOKAHEAD_STEPS = 4;

/** A later step only wins the projection if it's this much closer than
 * the earliest close candidate - keeps a fix sitting on a junction (equally
 * close to both steps) on the earlier one. */
const PROJECTION_TIE_TOLERANCE_M = 5;

/** A fix projected onto the very end of the final leg only counts as
 * arrival while it's roughly on the road - an off-route driver whose
 * nearest route point happens to be the destination hasn't arrived. */
const ARRIVAL_MAX_LATERAL_M = 60;

export interface StepProgress {
  /** Index into `steps` of the step the driver is currently travelling
   * along - the maneuver still to come is steps[currentStepIndex + 1]. */
  currentStepIndex: number;
  /** Along-route distance to the next maneuver - or, once hasArrived,
   * straight-line distance to the destination itself. */
  distanceToNextManeuverM: number;
  /** The current step's remaining along-route distance plus every later
   * step's distance. */
  remainingDistanceM: number;
  hasArrived: boolean;
}

function stepTargetLocation(step: MapboxRouteStep): GeoPoint {
  return { latitude: step.maneuver.location[1], longitude: step.maneuver.location[0] };
}

/** A step's own geometry, or - when Mapbox (or a test) supplies fewer than
 * two coordinates - the straight line from its maneuver to the next one. */
function stepPath(steps: readonly MapboxRouteStep[], index: number): GeoPoint[] {
  const coordinates = steps[index].geometry?.coordinates ?? [];
  if (coordinates.length >= 2) {
    return coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));
  }
  const start = stepTargetLocation(steps[index]);
  return index + 1 < steps.length ? [start, stepTargetLocation(steps[index + 1])] : [start];
}

const METERS_PER_DEGREE_LAT = 111_320;

interface Projection {
  stepIndex: number;
  lateralM: number;
  /** 0..1 along the step's own path. */
  fraction: number;
}

function projectOntoStep(point: GeoPoint, path: readonly GeoPoint[], stepIndex: number): Projection {
  if (path.length < 2) {
    return { stepIndex, lateralM: haversineDistance(point, path[0]), fraction: 1 };
  }

  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((point.latitude * Math.PI) / 180);
  const toXY = (p: GeoPoint) => ({
    x: (p.longitude - point.longitude) * metersPerDegreeLon,
    y: (p.latitude - point.latitude) * METERS_PER_DEGREE_LAT,
  });

  let totalM = 0;
  let bestLateralM = Number.POSITIVE_INFINITY;
  let bestAlongM = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = toXY(path[i]);
    const b = toXY(path[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const segmentM = Math.sqrt(lengthSq);
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSq));
    const lateralM = Math.hypot(a.x + dx * t, a.y + dy * t);
    if (lateralM < bestLateralM) {
      bestLateralM = lateralM;
      bestAlongM = totalM + segmentM * t;
    }
    totalM += segmentM;
  }

  return { stepIndex, lateralM: bestLateralM, fraction: totalM === 0 ? 1 : bestAlongM / totalM };
}

/**
 * Projects the fix onto the route's step geometry (never behind
 * `previousStepIndex`, at most PROJECTION_LOOKAHEAD_STEPS ahead) so the
 * step index, distances and arrival keep moving between sparse GPS fixes -
 * a fix doesn't have to land within STEP_ARRIVAL_THRESHOLD_M of a
 * maneuver for the step to advance, which at driving speed with 3s fixes
 * it often doesn't. `steps` is one route's full, in-order step list;
 * Mapbox's final step is always an "arrive" step with no maneuver after it.
 */
export function computeStepProgress(
  driverPosition: GeoPoint,
  steps: readonly MapboxRouteStep[],
  previousStepIndex: number
): StepProgress {
  if (steps.length === 0) {
    return { currentStepIndex: 0, distanceToNextManeuverM: 0, remainingDistanceM: 0, hasArrived: true };
  }

  const lastIndex = steps.length - 1;
  const startIndex = Math.min(Math.max(previousStepIndex, 0), lastIndex);
  const endIndex = Math.min(lastIndex, startIndex + PROJECTION_LOOKAHEAD_STEPS);

  const projections: Projection[] = [];
  for (let index = startIndex; index <= endIndex; index++) {
    projections.push(projectOntoStep(driverPosition, stepPath(steps, index), index));
  }
  const closestLateralM = Math.min(...projections.map((projection) => projection.lateralM));
  let projection =
    projections.find((candidate) => candidate.lateralM <= closestLateralM + PROJECTION_TIE_TOLERANCE_M) ??
    projections[0];

  let currentStepIndex = projection.stepIndex;
  const remainingInStepM = (index: number, fraction: number) => steps[index].distance * (1 - fraction);

  // Past the end of the current step's path (or within the threshold of the
  // next maneuver) means that maneuver is behind the driver.
  while (currentStepIndex < lastIndex) {
    const nextManeuver = stepTargetLocation(steps[currentStepIndex + 1]);
    const nearManeuver = haversineDistance(driverPosition, nextManeuver) <= STEP_ARRIVAL_THRESHOLD_M;
    const projectedPastIt =
      projection.stepIndex === currentStepIndex &&
      projection.lateralM <= ARRIVAL_MAX_LATERAL_M &&
      remainingInStepM(currentStepIndex, projection.fraction) <= STEP_ARRIVAL_THRESHOLD_M &&
      currentStepIndex + 1 === lastIndex;
    if (!nearManeuver && !projectedPastIt) break;
    currentStepIndex += 1;
    projection = projectOntoStep(driverPosition, stepPath(steps, currentStepIndex), currentStepIndex);
  }

  const hasArrived = currentStepIndex >= lastIndex;
  if (hasArrived) {
    return {
      currentStepIndex,
      distanceToNextManeuverM: haversineDistance(driverPosition, stepTargetLocation(steps[lastIndex])),
      remainingDistanceM: 0,
      hasArrived,
    };
  }

  const distanceToNextManeuverM =
    projection.stepIndex === currentStepIndex
      ? remainingInStepM(currentStepIndex, projection.fraction)
      : haversineDistance(driverPosition, stepTargetLocation(steps[currentStepIndex + 1]));
  const laterStepsDistanceM = steps
    .slice(currentStepIndex + 1)
    .reduce((total, step) => total + step.distance, 0);

  return {
    currentStepIndex,
    distanceToNextManeuverM,
    remainingDistanceM: distanceToNextManeuverM + laterStepsDistanceM,
    hasArrived,
  };
}
