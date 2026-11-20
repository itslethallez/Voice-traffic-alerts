import { fetchForwardRoute, type ForwardRoute } from '../api/mapbox/forwardRoute';
import { ROAD_MATCHING_ENABLED } from '../config/featureFlags';
import { bearingBetween, bearingDifference } from '../geo/bearing';
import { haversineDistance } from '../geo/distance';
import type { GeoPoint } from '../geo/types';
import type { DriverState, RoadContext } from '../engine/types';
import { classifyRouteSegment, type RoadTarget } from './classifyRoute';
import { cumulativeDistances, projectOntoPolyline } from './routeGeometry';

/**
 * Road matching for Cruise: is this alert on the road I'm driving, how far
 * along it, or is it somewhere else / behind me?
 *
 * One Mapbox Directions request per alert (api/mapbox/forwardRoute.ts),
 * made while the alert is still approaching the warn radius so the answer
 * is in before it's announced - then kept and re-used:
 * - while the driver stays on that route, the along-road distance is
 *   re-measured locally on every fix (no new request);
 * - any other alert lying on a route already fetched is classified from
 *   it for free ("covered");
 * - a new request is made only when the driver leaves the route.
 * Requests are rationed (MAX_LOOKUPS_PER_HOUR); past the budget, while a
 * request is still out, or if road matching is down, alerts fall back to
 * the honest "nearby, X away" wording - never "ahead" without a check.
 *
 * Log tag: [road] - one line per lookup, cover, failure and budget event,
 * so a drive test shows exactly how many Directions calls it cost.
 */

/** Further off the driver's heading than this, it's behind: silent, and
 * not worth a request. Wider than the 45-degree announce cone on purpose -
 * a road bending away (case D) is still "ahead" once the route confirms
 * it; "nearby" alerts keep the 45-degree cone (trip/tripRuntime.ts). */
export const BEHIND_BEARING_DEG = 100;
/** Driver further than this from a cached route has left it. */
const ON_ROUTE_METERS = 50;
/** A target this close to a cached route lies on it. */
const COVERED_METERS = 30;
/** A non-route answer (nearby after a failure, budget) is re-asked after
 * the driver moves this far, or this long. */
const FIXED_ANSWER_MAX_MOVE_METERS = 1_000;
const FIXED_ANSWER_MAX_AGE_MS = 90_000;
/** An alert waits at most this long for its first answer before being
 * spoken as "nearby" anyway - never held back indefinitely. */
export const MAX_PENDING_MS = 6_000;
const MAX_CONCURRENT_LOOKUPS = 2;
/** Cost cap per device: ~1 request a minute of driving. See the Stage 3
 * PR notes for what that means at 1,000 daily users. */
export const MAX_LOOKUPS_PER_HOUR = 60;
const MAX_CACHED_ROUTES = 8;
/** After this many failures in a row, road matching is "degraded" and the
 * UI says so (trip/tripRuntime.ts's banner). */
const DEGRADED_AFTER_FAILURES = 3;

type Fetcher = (from: GeoPoint, headingDeg: number, to: GeoPoint) => Promise<ForwardRoute>;

interface CachedRoute {
  route: ForwardRoute;
  cumulative: number[];
  /** Furthest the driver has been seen along it - guards against GPS
   * jitter projecting them backwards. */
  lastProgress: number;
}

type Entry =
  | { kind: 'route'; route: CachedRoute; targetOffset: number; context: RoadContext }
  | { kind: 'fixed'; context: RoadContext; decidedAt: GeoPoint; decidedAtMs: number };

let fetcher: Fetcher = (from, heading, to) => fetchForwardRoute(from, heading, to);
const entries = new Map<string, Entry>();
const inFlight = new Set<string>();
const firstAskedAtMs = new Map<string, number>();
let routes: CachedRoute[] = [];
let lookupTimes: number[] = [];
let consecutiveFailures = 0;
let budgetLogged = false;
let stats = { lookups: 0, covered: 0, failures: 0 };

export type RoadLookup = RoadContext | 'pending';

export function roadContextFor(target: RoadTarget, driver: DriverState, nowMs: number): RoadLookup {
  if (!ROAD_MATCHING_ENABLED) return { kind: 'nearby' };
  if (driver.headingReliable === false) return { kind: 'nearby' };

  const straightLine = haversineDistance(driver.position, target.position);
  const bearingDiff = bearingDifference(driver.headingDeg, bearingBetween(driver.position, target.position));
  if (bearingDiff > BEHIND_BEARING_DEG) return { kind: 'behind' };

  const existing = entries.get(target.id);
  if (existing) {
    const answer = reuse(existing, driver, nowMs);
    if (answer) return answer;
    entries.delete(target.id);
  }

  const covered = coverFromCachedRoutes(target, driver, straightLine);
  if (covered) {
    entries.set(target.id, covered.entry);
    stats.covered += 1;
    console.log(`[road] covered ${target.id} from a cached route: ${describe(covered.context)}`);
    return covered.context;
  }

  if (!firstAskedAtMs.has(target.id)) firstAskedAtMs.set(target.id, nowMs);
  const waited = nowMs - (firstAskedAtMs.get(target.id) ?? nowMs);

  if (!inFlight.has(target.id)) {
    if (!withinBudget(nowMs)) {
      if (!budgetLogged) {
        console.warn(`[road] lookup budget (${MAX_LOOKUPS_PER_HOUR}/h) reached - alerts say "nearby" until it frees up`);
        budgetLogged = true;
      }
      return { kind: 'nearby' };
    }
    if (inFlight.size < MAX_CONCURRENT_LOOKUPS) startLookup(target, driver, straightLine, nowMs);
  }
  return waited > MAX_PENDING_MS ? { kind: 'nearby' } : 'pending';
}

function reuse(entry: Entry, driver: DriverState, nowMs: number): RoadContext | null {
  if (entry.kind === 'fixed') {
    const moved = haversineDistance(entry.decidedAt, driver.position);
    if (moved > FIXED_ANSWER_MAX_MOVE_METERS || nowMs - entry.decidedAtMs > FIXED_ANSWER_MAX_AGE_MS) return null;
    return entry.context;
  }
  const cached = entry.route;
  const at = projectOntoPolyline(driver.position, cached.route.polyline, cached.cumulative);
  if (at.offsetMeters > ON_ROUTE_METERS || at.progressMeters < cached.lastProgress - ON_ROUTE_METERS) return null;
  cached.lastProgress = Math.max(cached.lastProgress, at.progressMeters);
  if (entry.context.kind !== 'ahead') return entry.context;
  const along = entry.targetOffset - at.progressMeters;
  if (along < -COVERED_METERS) return { kind: 'behind' }; // driven past it
  return { ...entry.context, alongRoadMeters: Math.max(0, along) };
}

function coverFromCachedRoutes(
  target: RoadTarget,
  driver: DriverState,
  straightLine: number
): { entry: Entry; context: RoadContext } | null {
  for (const cached of routes) {
    const at = projectOntoPolyline(driver.position, cached.route.polyline, cached.cumulative);
    if (at.offsetMeters > ON_ROUTE_METERS) continue;
    const there = projectOntoPolyline(target.position, cached.route.polyline, cached.cumulative);
    if (there.offsetMeters > COVERED_METERS || there.progressMeters <= at.progressMeters) continue;
    const context = classifyRouteSegment(
      cached.route,
      at.progressMeters,
      there.progressMeters,
      target,
      straightLine,
      there.offsetMeters
    );
    // Only a confident "ahead" is taken from someone else's route: a
    // route that merely passes near the target (a parallel street 25m
    // over) says nothing reliable about it otherwise.
    if (context.kind !== 'ahead') continue;
    return { entry: { kind: 'route', route: cached, targetOffset: there.progressMeters, context }, context };
  }
  return null;
}

function startLookup(target: RoadTarget, driver: DriverState, straightLine: number, nowMs: number): void {
  inFlight.add(target.id);
  lookupTimes.push(nowMs);
  stats.lookups += 1;
  const n = stats.lookups;
  const startedAtMs = Date.now();
  fetcher(driver.position, driver.headingDeg, target.position)
    .then((route) => {
      const cached: CachedRoute = { route, cumulative: cumulativeDistances(route.polyline), lastProgress: 0 };
      const context = classifyRouteSegment(
        route,
        0,
        route.distanceMeters,
        target,
        straightLine,
        route.destinationSnapMeters
      );
      routes = [cached, ...routes].slice(0, MAX_CACHED_ROUTES);
      entries.set(target.id, { kind: 'route', route: cached, targetOffset: route.distanceMeters, context });
      consecutiveFailures = 0;
      console.log(
        `[road] lookup #${n} ${target.id} in ${Date.now() - startedAtMs}ms: ${describe(context)} ` +
          `(road ${Math.round(route.distanceMeters)}m vs straight ${Math.round(straightLine)}m, snap ${Math.round(route.destinationSnapMeters)}m, ` +
          `via ${route.steps.map((s) => `${s.maneuverType}${s.modifier ? `/${s.modifier}` : ''}:${s.name || '-'}`).join(' > ')})`
      );
    })
    .catch((error: unknown) => {
      stats.failures += 1;
      consecutiveFailures += 1;
      entries.set(target.id, {
        kind: 'fixed',
        context: { kind: 'nearby' },
        decidedAt: driver.position,
        decidedAtMs: Date.now(),
      });
      console.warn(
        `[road] lookup #${n} ${target.id} failed after ${Date.now() - startedAtMs}ms (${consecutiveFailures} in a row): ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    })
    .finally(() => {
      inFlight.delete(target.id);
    });
}

function withinBudget(nowMs: number): boolean {
  lookupTimes = lookupTimes.filter((t) => nowMs - t < 60 * 60 * 1000);
  if (lookupTimes.length < MAX_LOOKUPS_PER_HOUR) {
    budgetLogged = false;
    return true;
  }
  return false;
}

function describe(context: RoadContext): string {
  return context.kind === 'ahead'
    ? `ahead on ${context.roadName ?? '(unnamed road)'} ${Math.round(context.alongRoadMeters)}m`
    : context.kind;
}

/** True after DEGRADED_AFTER_FAILURES lookups in a row have failed - the
 * UI discloses that "ahead" can't currently be confirmed. */
export function isRoadMatchingDegraded(): boolean {
  return consecutiveFailures >= DEGRADED_AFTER_FAILURES;
}

export function getRoadMatchingStats(): { lookups: number; covered: number; failures: number } {
  return { ...stats };
}

export function resetRoadContext(): void {
  entries.clear();
  inFlight.clear();
  firstAskedAtMs.clear();
  routes = [];
  lookupTimes = [];
  consecutiveFailures = 0;
  budgetLogged = false;
  stats = { lookups: 0, covered: 0, failures: 0 };
}

/** Test seam: replace the Directions call. */
export function setForwardRouteFetcherForTests(next: Fetcher | null): void {
  fetcher = next ?? ((from, heading, to) => fetchForwardRoute(from, heading, to));
}
