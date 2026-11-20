import type { ForwardRoute, ForwardRouteStep } from '../api/mapbox/forwardRoute';
import type { GeoPoint } from '../geo/types';
import type { RoadContext } from '../engine/types';
import { anySameRoad, normalizeRoadName, sameRoad } from './roadNames';
import { cumulativeDistances, projectOntoPolyline } from './routeGeometry';

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
/** Road distance this far beyond straight-line is a detour, not "ahead"
 * (2x, 21 Nov 2026 - on top of the no-turn-off rule). */
export const MAX_DETOUR_RATIO = 2;
/** A U-turn route's target this close to the driver's own carriageway, on
 * the same road name, is the other side of a divided road (21 Nov 2026). */
export const OTHER_CARRIAGEWAY_MAX_METERS = 60;

const cumulativeCache = new WeakMap<ForwardRoute, number[]>();
function cumulativeFor(route: ForwardRoute): number[] {
  let cum = cumulativeCache.get(route);
  if (!cum) {
    cum = cumulativeDistances(route.polyline);
    cumulativeCache.set(route, cum);
  }
  return cum;
}

function continuesOn(step: ForwardRouteStep, previousRoad: string): boolean {
  return CONTINUING_TYPES.has(step.maneuverType) || step.modifier === 'straight' || sameRoad(step.name, previousRoad);
}

/**
 * A report naming the driver's own road, within OTHER_CARRIAGEWAY_MAX_METERS
 * of it (either carriageway), is "on {road}" with no side claimed - whatever
 * the router does to reach it. Waze reports carry no direction, and a
 * router snaps one in or across the median onto the far carriageway, then
 * reaches it by a U-turn (Sir Donald Bradman Drive, Stage 3 drive test) or,
 * where there's nowhere to turn, by looping round a side street (Main North
 * Road, Elizabeth - Valhalla/Mapbox trial, 21 Nov 2026). Either way it's on
 * the road being driven.
 *
 * "The driver's road" is the stretch of the route from the driver up to
 * the first turn off it or U-turn; the report has to project onto that
 * stretch, ahead of the driver, and name the road at that point.
 * Decision 21 Nov 2026 (case C). Fixtures: road/__tests__/aheadCases.test.ts.
 */
function onDriversRoadAnyCarriageway(
  route: ForwardRoute,
  starts: readonly number[],
  fromIndex: number,
  fromOffset: number,
  target: RoadTarget,
  usableStreets: readonly string[]
): RoadContext | null {
  if (target.kind !== 'alert' && target.kind !== 'policeReport') return null;
  if (usableStreets.length === 0) return null;
  const steps = route.steps;
  let previousRoad = steps[fromIndex].name;
  let i = fromIndex + 1;
  for (; i < steps.length; i++) {
    if (steps[i].modifier === 'uturn' || !continuesOn(steps[i], previousRoad)) break;
    if (steps[i].name) previousRoad = steps[i].name;
  }
  const stretchEnd = i < steps.length ? starts[i] : route.distanceMeters;
  if (stretchEnd <= fromOffset) return null;
  const level = projectOntoPolyline(target.position, route.polyline, cumulativeFor(route), {
    from: fromOffset,
    to: stretchEnd,
  });
  if (level.offsetMeters > OTHER_CARRIAGEWAY_MAX_METERS) return null;
  const along = level.progressMeters - fromOffset;
  // Level with the driver (or clamped to the stretch's start): not ahead.
  if (along <= 1) return null;
  const roadThere = steps[stepIndexAt(starts, level.progressMeters)].name || steps[fromIndex].name;
  if (!roadThere || !anySameRoad(usableStreets, roadThere)) return null;
  return { kind: 'onRoad', roadName: roadThere, alongRoadMeters: along };
}

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
 * A U-turn means "behind" (silent). A report naming the driver's road
 * within 60m of it is "onRoad" whatever the route does (see
 * onDriversRoadAnyCarriageway). Anything else short of "ahead" is
 * "nearby" - with offRoad set when the route shows it's on another road.
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

  const usableStreets = target.streets.filter((s) => normalizeRoadName(s) !== null);

  // Maneuvers strictly between the driver and the target.
  for (let i = fromIndex + 1; i <= toIndex; i++) {
    if (steps[i].modifier === 'uturn') {
      return onDriversRoadAnyCarriageway(route, starts, fromIndex, fromOffset, target, usableStreets) ?? { kind: 'behind' };
    }
  }

  const snapLimit = usableStreets.length > 0 ? MAX_SNAP_METERS : MAX_SNAP_METERS_UNNAMED;
  // Not on a road we can vouch for - unknown, not confirmed off-road.
  if (snapMeters > snapLimit) {
    return onDriversRoadAnyCarriageway(route, starts, fromIndex, fromOffset, target, usableStreets) ?? { kind: 'nearby' };
  }

  // Short of "ahead" from here on, the route itself shows the target is
  // off the driver's road (offRoad) - unless it's a same-road report on
  // the other carriageway.
  const offRoad = (): RoadContext =>
    onDriversRoadAnyCarriageway(route, starts, fromIndex, fromOffset, target, usableStreets) ?? { kind: 'nearby', offRoad: true };

  const alongMeters = toOffset - fromOffset;
  if (straightLineMeters > 0 && alongMeters > straightLineMeters * MAX_DETOUR_RATIO) return offRoad();

  const driverRoad = steps[fromIndex].name;
  let previousRoad = driverRoad;
  for (let i = fromIndex + 1; i <= toIndex; i++) {
    const step = steps[i];
    if (!continuesOn(step, previousRoad)) return offRoad();
    if (target.kind === 'mobileCamera' && !sameRoad(step.name, driverRoad)) return offRoad();
    if (step.name) previousRoad = step.name;
  }

  const arrivalRoad = steps[toIndex].name;
  if (usableStreets.length > 0 && !anySameRoad(usableStreets, arrivalRoad)) return offRoad();
  if (target.kind === 'mobileCamera' && !anySameRoad(usableStreets, driverRoad)) return offRoad();

  return { kind: 'ahead', roadName: arrivalRoad || null, alongRoadMeters: alongMeters };
}
