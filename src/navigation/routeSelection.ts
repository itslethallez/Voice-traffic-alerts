import type { MapboxDirectionsResponse, MapboxRoute } from '../api/mapbox/types';
import { scoreRouteHazardExposure, type RouteHazard } from '../engine/routeHazardScore';
import type { GeoPoint } from '../geo/types';

/** How far around a candidate route a currently-reported hazard still
 * counts against it - wide enough to catch a hazard on a parallel side
 * street Mapbox's route geometry passes close to, narrow enough not to
 * penalize a route for something genuinely unrelated to it. */
export const HAZARD_CORRIDOR_METERS = 300;

export interface ScoredRoute {
  route: MapboxRoute;
  /** route.geometry.coordinates converted from Mapbox's [lon,lat] GeoJSON
   * order to this app's GeoPoint once here, so nothing downstream has to
   * remember which axis order it's holding. */
  polyline: GeoPoint[];
  hazardScore: number;
  /** Position in Mapbox's own routes[] array - 0 is what Mapbox itself
   * would have picked. Used as a stable tiebreaker when hazard scores tie. */
  mapboxRank: number;
}

export function toPolyline(route: MapboxRoute): GeoPoint[] {
  return route.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));
}

/**
 * Scores every route Mapbox returned and orders them best-first. With
 * avoidHazards off, every hazardScore is 0 and Mapbox's own ranking is
 * preserved untouched (routes[0] first) - this never reorders anything
 * unless the driver has actually opted in. Not a guarantee the winning
 * route avoids every hazard: see navigationRuntime.ts's doc comment for
 * why Mapbox's Directions API can't be asked to exclude arbitrary points
 * server-side, only scored after the fact against whichever alternatives
 * it happened to return (up to ~3).
 */
export function scoreAndRankRoutes(
  response: MapboxDirectionsResponse,
  hazards: readonly RouteHazard[],
  avoidHazards: boolean
): ScoredRoute[] {
  const scored: ScoredRoute[] = response.routes.map((route, mapboxRank) => {
    const polyline = toPolyline(route);
    const hazardScore = avoidHazards ? scoreRouteHazardExposure(polyline, hazards, HAZARD_CORRIDOR_METERS) : 0;
    return { route, polyline, hazardScore, mapboxRank };
  });

  if (!avoidHazards) return scored;
  return [...scored].sort((a, b) => a.hazardScore - b.hazardScore || a.mapboxRank - b.mapboxRank);
}
