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
 * One forward route per alert (api/mapbox/forwardRoute.ts - from Shotgun's
 * server, which shares routes across drivers, or straight from Mapbox),
 * asked for only once the alert is inside its warn radius - then reused
 * for as long as it can be ("per road segment"):
 * - while the driver stays on that route, the verdict is re-derived from
 *   the route's remaining steps on every fix (no request): the distance
 *   shrinks along the road, and a "nearby" turns into "ahead" once the
 *   driver takes the turn onto the alert's road;
 * - any other alert lying ahead on a route already fetched is classified
 *   from it for free ("covered");
 * - a new request is made only when the driver leaves the route.
 * Alerts still outside the radius only get a peek (peekRoadContext) at
 * what's already known - no request. Requests are rationed
 * (MAX_LOOKUPS_PER_HOUR); past the budget, while a request is still out,
 * or if road matching is down, alerts fall back to the honest "nearby, X
 * away" wording - never "ahead" without a check - and the UI says so.
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
export const ON_ROUTE_METERS = 50;
/** A target this close to a cached route lies on it. */
const COVERED_METERS = 30;
/** A failed lookup's "nearby" is re-asked after the driver moves this far,
 * or this long. */
const FAILED_ANSWER_MAX_MOVE_METERS = 1_000;
const FAILED_ANSWER_MAX_AGE_MS = 90_000;
/** Straight-line distance this far beyond the closest the driver has been
 * to a target: they're driving away from it, so it's behind - no request.
 * The second Stage 3 drive test re-asked a passed police report 26 times
 * as it fell back from 337m to 4.3km. */
export const RECEDING_MARGIN_METERS = 300;
/** An alert waits at most this long for its first answer before being
 * spoken as "nearby" anyway - never held back indefinitely. */
export const MAX_PENDING_MS = 6_000;
/** The same target is asked about at most this often. A route that turns
 * off the driver's road early is left within seconds when they carry on
 * straight; the cold-start drive test re-asked one camera 6s later. In
 * between, the last verdict stands - "behind" stays behind, anything else
 * is "nearby" (never "ahead" without a route under the driver). */
export const MIN_RELOOKUP_MS = 30_000;
/** Left a route without turning (heading within this of when it was
 * decided): still on the same road, so a "nearby" / "behind" verdict
 * still holds - the turn-off it needed is now behind you. Kept until the
 * driver turns or has covered SAME_ROAD_MAX_METERS. This is what "per road
 * segment" means for alerts off your road: the standard drive test was
 * re-asking side-road cameras every 30s as it drove past their turns. */
const SAME_ROAD_HEADING_DEG = 30;
const SAME_ROAD_MAX_METERS = 2_000;
const MAX_CONCURRENT_LOOKUPS = 2;
/** Cost cap per device. Unchanged on 21 Nov 2026 - cut calls first. */
export const MAX_LOOKUPS_PER_HOUR = 60;
const MAX_CACHED_ROUTES = 12;
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
  | {
      kind: 'route';
      route: CachedRoute;
      targetOffset: number;
      snapMeters: number;
      /** Where / which way the driver was when this was decided - see
       * SAME_ROAD_HEADING_DEG. */
      decidedAt: GeoPoint;
      decidedHeadingDeg: number;
      lastContext: RoadContext | null;
    }
  | { kind: 'failed'; decidedAt: GeoPoint; decidedAtMs: number };

let fetcher: Fetcher = (from, heading, to) => fetchForwardRoute(from, heading, to);
const entries = new Map<string, Entry>();
const inFlight = new Set<string>();
const firstAskedAtMs = new Map<string, number>();
const lastLookup = new Map<string, { atMs: number; context: RoadContext }>();
/** Closest straight-line distance seen per target this trip. */
const closestSeen = new Map<string, number>();
const recedingLogged = new Set<string>();
let routes: CachedRoute[] = [];
let lookupTimes: number[] = [];
let consecutiveFailures = 0;
let budgetLogged = false;
/** True while the hourly budget is used up - disclosed like a failure. */
let budgetExhausted = false;
let stats = { lookups: 0, covered: 0, failures: 0, reused: 0 };

export type RoadLookup = RoadContext | 'pending';

/** What's known without a request, or null - the checks every path shares. */
function known(target: RoadTarget, driver: DriverState): RoadContext | null {
  if (!ROAD_MATCHING_ENABLED) return { kind: 'nearby' };
  if (driver.headingReliable === false) return { kind: 'nearby' };

  const straightLine = haversineDistance(driver.position, target.position);
  const bearingDiff = bearingDifference(driver.headingDeg, bearingBetween(driver.position, target.position));
  if (bearingDiff > BEHIND_BEARING_DEG) return { kind: 'behind' };

  const closest = Math.min(closestSeen.get(target.id) ?? Infinity, straightLine);
  closestSeen.set(target.id, closest);
  if (straightLine > closest + RECEDING_MARGIN_METERS) {
    if (!recedingLogged.has(target.id)) {
      recedingLogged.add(target.id);
      console.log(`[road] ${target.id} receding (${Math.round(straightLine)}m, closest ${Math.round(closest)}m) - behind, no lookup`);
    }
    return { kind: 'behind' };
  }
  return null;
}

/**
 * Road context for a target inside its warn radius: answers from what's
 * known, or starts a lookup and returns 'pending' (for at most
 * MAX_PENDING_MS, then "nearby").
 */
export function roadContextFor(target: RoadTarget, driver: DriverState, nowMs: number): RoadLookup {
  const shortcut = known(target, driver);
  if (shortcut) return shortcut;
  const straightLine = haversineDistance(driver.position, target.position);

  const cached = fromCache(target, driver, straightLine, nowMs);
  if (cached) return cached;

  const previous = lastLookup.get(target.id);
  if (previous && nowMs - previous.atMs < MIN_RELOOKUP_MS && !inFlight.has(target.id)) {
    return previous.context.kind === 'behind' ? previous.context : { kind: 'nearby' };
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

/**
 * For targets still outside their warn radius (the TTS prefetch's
 * prediction): whatever is already known, never a request - lookups wait
 * until the alert is inside the radius (21 Nov 2026 cost decision).
 */
export function peekRoadContext(target: RoadTarget, driver: DriverState, nowMs: number): RoadContext | null {
  const shortcut = known(target, driver);
  if (shortcut) return shortcut;
  return fromCache(target, driver, haversineDistance(driver.position, target.position), nowMs);
}

function fromCache(target: RoadTarget, driver: DriverState, straightLine: number, nowMs: number): RoadContext | null {
  const existing = entries.get(target.id);
  if (existing) {
    const answer = reuse(existing, target, driver, straightLine, nowMs);
    if (answer) {
      stats.reused += 1;
      return answer;
    }
    entries.delete(target.id);
  }
  const covered = coverFromCachedRoutes(target, driver, straightLine);
  if (covered) {
    entries.set(target.id, covered.entry);
    stats.covered += 1;
    console.log(`[road] covered ${target.id} from a cached route: ${describe(covered.context)}`);
    return covered.context;
  }
  return null;
}

/** Where the driver is along a cached route, or null if they've left it. */
function progressOn(cached: CachedRoute, driver: DriverState): number | null {
  const at = projectOntoPolyline(driver.position, cached.route.polyline, cached.cumulative);
  if (at.offsetMeters > ON_ROUTE_METERS || at.progressMeters < cached.lastProgress - ON_ROUTE_METERS) return null;
  return at.progressMeters;
}

function reuse(
  entry: Entry,
  target: RoadTarget,
  driver: DriverState,
  straightLine: number,
  nowMs: number
): RoadContext | null {
  if (entry.kind === 'failed') {
    const moved = haversineDistance(entry.decidedAt, driver.position);
    if (moved > FAILED_ANSWER_MAX_MOVE_METERS || nowMs - entry.decidedAtMs > FAILED_ANSWER_MAX_AGE_MS) return null;
    return { kind: 'nearby' };
  }
  const cached = entry.route;
  const progress = progressOn(cached, driver);
  if (progress === null) {
    const verdict = entry.lastContext;
    const sameRoad =
      verdict !== null &&
      (verdict.kind === 'nearby' || verdict.kind === 'behind') &&
      bearingDifference(driver.headingDeg, entry.decidedHeadingDeg) <= SAME_ROAD_HEADING_DEG &&
      haversineDistance(entry.decidedAt, driver.position) <= SAME_ROAD_MAX_METERS;
    return sameRoad ? verdict : null;
  }
  cached.lastProgress = Math.max(cached.lastProgress, progress);
  if (entry.targetOffset - progress < -COVERED_METERS) return { kind: 'behind' }; // driven past it
  const context = classifyRouteSegment(
    cached.route,
    Math.min(progress, entry.targetOffset - 1),
    entry.targetOffset,
    target,
    straightLine,
    entry.snapMeters
  );
  entry.lastContext = context;
  entry.decidedHeadingDeg = driver.headingDeg;
  entry.decidedAt = driver.position;
  return context;
}

function coverFromCachedRoutes(
  target: RoadTarget,
  driver: DriverState,
  straightLine: number
): { entry: Entry; context: RoadContext } | null {
  for (const cached of routes) {
    const progress = progressOn(cached, driver);
    if (progress === null) continue;
    const there = projectOntoPolyline(target.position, cached.route.polyline, cached.cumulative);
    if (there.offsetMeters > COVERED_METERS || there.progressMeters <= progress) continue;
    const context = classifyRouteSegment(
      cached.route,
      progress,
      there.progressMeters,
      target,
      straightLine,
      there.offsetMeters
    );
    // Only a confident "ahead" is taken from someone else's route: a
    // route that merely passes near the target (a parallel street 25m
    // over) says nothing reliable about it otherwise.
    if (context.kind !== 'ahead') continue;
    return {
      entry: {
        kind: 'route',
        route: cached,
        targetOffset: there.progressMeters,
        snapMeters: there.offsetMeters,
        decidedAt: driver.position,
        decidedHeadingDeg: driver.headingDeg,
        lastContext: context,
      },
      context,
    };
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
      // A shared route (server cache) starts wherever its first driver
      // was; this driver is somewhere along it.
      const at = projectOntoPolyline(driver.position, route.polyline, cached.cumulative);
      const fromOffset = Math.min(at.progressMeters, Math.max(0, route.distanceMeters - 1));
      cached.lastProgress = fromOffset;
      const context = classifyRouteSegment(
        route,
        fromOffset,
        route.distanceMeters,
        target,
        straightLine,
        route.destinationSnapMeters
      );
      routes = [cached, ...routes].slice(0, MAX_CACHED_ROUTES);
      lastLookup.set(target.id, { atMs: nowMs, context });
      entries.set(target.id, {
        kind: 'route',
        route: cached,
        targetOffset: route.distanceMeters,
        snapMeters: route.destinationSnapMeters,
        decidedAt: driver.position,
        decidedHeadingDeg: driver.headingDeg,
        lastContext: context,
      });
      consecutiveFailures = 0;
      console.log(
        `[road] lookup #${n} ${target.id} in ${Date.now() - startedAtMs}ms via ${route.router ?? 'mapbox-direct'}${route.shared ? ' (shared)' : ''}: ${describe(context)} ` +
          `(road ${Math.round(route.distanceMeters - fromOffset)}m vs straight ${Math.round(straightLine)}m, snap ${Math.round(route.destinationSnapMeters)}m, ` +
          `via ${route.steps.map((s) => `${s.maneuverType}${s.modifier ? `/${s.modifier}` : ''}:${s.name || '-'}`).join(' > ')})`
      );
    })
    .catch((error: unknown) => {
      stats.failures += 1;
      consecutiveFailures += 1;
      entries.set(target.id, { kind: 'failed', decidedAt: driver.position, decidedAtMs: nowMs });
      lastLookup.set(target.id, { atMs: nowMs, context: { kind: 'nearby' } });
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
    budgetExhausted = false;
    return true;
  }
  budgetExhausted = true;
  return false;
}

function describe(context: RoadContext): string {
  if (context.kind === 'ahead') return `ahead on ${context.roadName ?? '(unnamed road)'} ${Math.round(context.alongRoadMeters)}m`;
  if (context.kind === 'onRoad') return `on ${context.roadName} (other carriageway) ${Math.round(context.alongRoadMeters)}m`;
  return context.kind;
}

/** True after DEGRADED_AFTER_FAILURES lookups in a row have failed, or
 * while the hourly lookup budget is used up - either way new alerts can't
 * be confirmed "ahead", and the UI says so (trip/tripRuntime.ts). */
export function isRoadMatchingDegraded(): boolean {
  return consecutiveFailures >= DEGRADED_AFTER_FAILURES || budgetExhausted;
}

export function getRoadMatchingStats(): { lookups: number; covered: number; failures: number; reused: number } {
  return { ...stats };
}

export function resetRoadContext(): void {
  entries.clear();
  inFlight.clear();
  firstAskedAtMs.clear();
  lastLookup.clear();
  closestSeen.clear();
  recedingLogged.clear();
  routes = [];
  lookupTimes = [];
  consecutiveFailures = 0;
  budgetLogged = false;
  budgetExhausted = false;
  stats = { lookups: 0, covered: 0, failures: 0, reused: 0 };
}

/** Test seam: replace the Directions call. */
export function setForwardRouteFetcherForTests(next: Fetcher | null): void {
  fetcher = next ?? ((from, heading, to) => fetchForwardRoute(from, heading, to));
}
