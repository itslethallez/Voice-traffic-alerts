import { fetchDirections, MapboxApiError } from '../api/mapbox/client';
import { hazardsNearRoute } from '../engine/routeHazardScore';
import type { GeoPoint } from '../geo/types';
import type { RouteType } from '../store/settingsDefaults';
import type { NavigationRoute } from '../store/useNavigationStore';
import { useRouteOptionsStore, type RouteOption, type RouteOptionId } from '../store/useRouteOptionsStore';
import { startNavigationWithRoute } from './navigationRuntime';
import { getHazardsForRouteScoring, HAZARD_CORRIDOR_METERS, scoreAndRankRoutes, type ScoredRoute } from './routeSelection';

/** Bumped on every load/clear so a Directions response for a superseded
 * destination (or a cleared plan) can't land and clobber newer state once
 * it finally resolves - the same generation-guard pattern
 * navigationRuntime.ts uses for its own in-flight requests. */
let routeOptionsGeneration = 0;

function toNavigationRoute(scored: ScoredRoute): NavigationRoute {
  return {
    polyline: scored.polyline,
    steps: scored.route.legs.flatMap((leg) => leg.steps),
    distanceMeters: scored.route.distance,
    durationSeconds: scored.route.duration,
    hazardScore: scored.hazardScore,
  };
}

function toRouteOption(id: RouteOptionId, scored: ScoredRoute, hazards: ReturnType<typeof getHazardsForRouteScoring>): RouteOption {
  return {
    id,
    route: toNavigationRoute(scored),
    hazardsOnRoute: hazardsNearRoute(scored.polyline, hazards, HAZARD_CORRIDOR_METERS),
  };
}

/**
 * Stage B's "show me the route choices" step - fires once a destination is
 * confirmed in NavigationSearchScreen, before any navigation exists.
 *
 * Two Directions requests in parallel:
 * - the default set (alternatives on) gives FASTEST (Mapbox's own pick)
 *   and the candidate pool SAFEST is scored from - re-ranking that same
 *   set by live hazard exposure, so SAFEST can only ever claim to avoid
 *   something a real alternative geometry actually avoids.
 * - `exclude=motorway` gives SIDE STREETS. Mapbox's Directions v5
 *   `exclude` only supports motorway/toll/ferry/unpaved (there is no
 *   'trunk' value - verified against the current docs), so motorway is
 *   as far as the server-side bias goes; the request is a bias, not a
 *   guarantee, and short trips may come back empty or identical to the
 *   default route. Empty means the card renders unavailable rather than
 *   faking a difference.
 *
 * Hazards are whatever the map is already showing the driver (the same
 * published/category-enabled set RadarMap renders - see
 * getHazardsForRouteScoring), not a second alert pipeline.
 */
export async function loadRouteOptions(
  origin: GeoPoint,
  destination: GeoPoint,
  destinationLabel: string | null
): Promise<void> {
  const generation = ++routeOptionsGeneration;
  useRouteOptionsStore.getState().startLoading({ destination, destinationLabel });

  try {
    const hazards = getHazardsForRouteScoring(origin, Date.now());
    const [standard, motorwayFree] = await Promise.all([
      fetchDirections([origin, destination], { alternatives: true }),
      fetchDirections([origin, destination], { alternatives: true, exclude: 'motorway' }),
    ]);
    if (generation !== routeOptionsGeneration) return; // superseded while these fetches were in flight

    const [fastest] = scoreAndRankRoutes(standard, hazards, false);
    if (!fastest) {
      throw new MapboxApiError('Mapbox Directions API returned no routes', null);
    }
    const [safest] = scoreAndRankRoutes(standard, hazards, true);
    const [sideStreets] = scoreAndRankRoutes(motorwayFree, hazards, true);

    const options: RouteOption[] = [
      toRouteOption('fastest', fastest, hazards),
      // safest always ranks the same response fastest came from, so it's
      // never absent - it just may BE fastest when no alternative is less
      // exposed, which the card copy states plainly instead of inventing
      // a difference that isn't there.
      toRouteOption('safest', safest, hazards),
      ...(sideStreets ? [toRouteOption('sidestreets', sideStreets, hazards)] : []),
    ];
    useRouteOptionsStore.getState().setReady(options);
  } catch (error) {
    if (generation !== routeOptionsGeneration) return;
    console.warn('[navigate] route options failed', error);
    useRouteOptionsStore
      .getState()
      .setError(error instanceof MapboxApiError ? error.message : 'Could not calculate routes.');
  }
}

export function selectRouteOption(id: RouteOptionId): void {
  useRouteOptionsStore.getState().select(id);
}

/** The RouteType navigationRuntime records for each option id - the
 * planning screen's 'fastest' is the engine's 'quickest' (same request),
 * while safest/sidestreets share names already. */
const OPTION_ID_TO_ROUTE_TYPE: Record<RouteOptionId, RouteType> = {
  fastest: 'quickest',
  safest: 'safest',
  sidestreets: 'sidestreets',
};

/**
 * The GO button's job: commit the currently-selected option to actual
 * turn-by-turn. Hands the already-fetched geometry straight to
 * navigationRuntime (startNavigationWithRoute - deliberately not
 * startNavigation, which would re-request Directions and could return a
 * different route than the card described), then clears the plan so the
 * options panel/map previews stand down as navigation chrome takes over.
 * No-op with no ready plan - the button only exists in that state anyway.
 */
export function confirmRouteSelection(): void {
  const { options, selectedId, destination, destinationLabel } = useRouteOptionsStore.getState();
  const option = options.find((candidate) => candidate.id === selectedId) ?? options[0];
  if (!option || !destination) return;

  startNavigationWithRoute({
    destination,
    destinationLabel,
    routeType: OPTION_ID_TO_ROUTE_TYPE[option.id],
    route: option.route,
  });
  clearRouteOptions();
}

/** Drops the whole plan (destination + candidates + selection) - the
 * panel's close affordance and the supersede path for a new pick. */
export function clearRouteOptions(): void {
  routeOptionsGeneration += 1; // invalidates any in-flight load
  useRouteOptionsStore.getState().clear();
}
