import type { ForwardRoute, ForwardRouteStep } from '../api/mapbox/forwardRoute';
import type { GeoPoint } from '../geo/types';
import type { RoadContext } from '../engine/types';
import { anySameRoad, normalizeRoadName, sameRoad } from './roadNames';

/**
 * What road matching knows about the thing it's classifying. `streets` are
 * the road names the source gives (Waze `street`, both roads of a SAPOL
 * camera intersection, a mobile-camera notice's street) - empty when the
 * source names no usable road.
 */
export interface RoadTarget {
  id: string;
  position: GeoPoint;
  streets: string[];
  /** Mobile-camera notices cover a whole street stretch: they're only
   * "ahead on X" while the driver is actually on X (20 Nov 2026 call). */
  kind: 'alert' | 'mobileCamera' | 'fixedCamera' | 'policeReport';
}

/** Mapbox moved the alert further than this to put it on a road: the point
 * isn't on a road we can vouch for (a suburb centroid, a car park). */
export const MAX_SNAP_METERS = 40;
/** With no street name to cross-check, the geometry has to be tight. */
export const MAX_SNAP_METERS_UNNAMED = 20;
/** Road distance this far beyond straight-line is a detour, not "ahead". */
export const MAX_DETOUR_RATIO = 3;

/** Maneuvers that keep you on the same road (or its continuation). */
const CONTINUING_TYPES = new Set(['continue', 'new name', 'merge', 'notification', 'depart', 'arrive']);

function stepStartOffsets(steps: readonly ForwardRouteStep[]): number[] {
  const starts: number[] = [];
  let acc = 0;
  for (const step of steps) {
    starts.push(acc);
    acc += step.distanceMeters;
  }
  return starts;
}

function stepIndexAt(starts: readonly number[], offset: number): number {
  let index = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= offset) index = i;
  return index;
}

/**
 * Classifies the stretch of `route` between `fromOffset` (where the driver
 * is, metres along it) and `toOffset` (where the target is). A whole fresh
 * route is fromOffset 0, toOffset route.distanceMeters; a cached route
 * reused for another alert along it (roadContextRuntime.ts) is a slice.
 *
 * "ahead" requires all of:
 * - a usable heading (checked by the caller),
 * - no U-turn between the driver and the target,
 * - every maneuver passed on the way keeps to the same road or its
 *   continuation - no turning off,
 * - the target's own street (if it names one) is the road it's reached on;
 *   mobile-camera notices additionally need the driver to be on that
 *   street already,
 * - the target actually sits on the road (snap distance), and the road
 *   distance isn't a detour.
 * A U-turn means "behind" (silent); anything else short of "ahead" is
 * "nearby".
 */
export function classifyRouteSegment(
  route: ForwardRoute,
  fromOffset: number,
  toOffset: number,
  target: RoadTarget,
  straightLineMeters: number,
  snapMeters: number
): RoadContext {
  const steps = route.steps;
  if (steps.length === 0 || toOffset <= fromOffset) return { kind: 'nearby' };
  const starts = stepStartOffsets(steps);
  const fromIndex = stepIndexAt(starts, fromOffset);
  const toIndex = stepIndexAt(starts, Math.max(fromOffset, toOffset - 1));

  // Maneuvers strictly between the driver and the target.
  for (let i = fromIndex + 1; i <= toIndex; i++) {
    if (steps[i].modifier === 'uturn') return { kind: 'behind' };
  }

  const usableStreets = target.streets.filter((s) => normalizeRoadName(s) !== null);
  const snapLimit = usableStreets.length > 0 ? MAX_SNAP_METERS : MAX_SNAP_METERS_UNNAMED;
  if (snapMeters > snapLimit) return { kind: 'nearby' };

  const alongMeters = toOffset - fromOffset;
  if (straightLineMeters > 0 && alongMeters > straightLineMeters * MAX_DETOUR_RATIO) return { kind: 'nearby' };

  const driverRoad = steps[fromIndex].name;
  let previousRoad = driverRoad;
  for (let i = fromIndex + 1; i <= toIndex; i++) {
    const step = steps[i];
    const continues =
      CONTINUING_TYPES.has(step.maneuverType) || step.modifier === 'straight' || sameRoad(step.name, previousRoad);
    if (!continues) return { kind: 'nearby' };
    if (target.kind === 'mobileCamera' && !sameRoad(step.name, driverRoad)) return { kind: 'nearby' };
    if (step.name) previousRoad = step.name;
  }

  const arrivalRoad = steps[toIndex].name;
  if (usableStreets.length > 0 && !anySameRoad(usableStreets, arrivalRoad)) return { kind: 'nearby' };
  if (target.kind === 'mobileCamera' && !anySameRoad(usableStreets, driverRoad)) return { kind: 'nearby' };

  return { kind: 'ahead', roadName: arrivalRoad || null, alongRoadMeters: alongMeters };
}
