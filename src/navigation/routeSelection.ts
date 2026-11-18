import type { MapboxDirectionsResponse, MapboxRoute } from '../api/mapbox/types';
import { scoreRouteHazardExposure, type RouteHazard } from '../engine/routeHazardScore';
import type { GeoPoint } from '../geo/types';
import { visibleManualReportAlerts } from '../store/manualReportAlert';
import { visibleNearbyReportAlerts } from '../store/nearbyReportAlert';
import { enabledTypesFromSettings, type RouteType } from '../store/settingsDefaults';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTripStore } from '../store/useTripStore';

/** How far around a candidate route a currently-reported hazard still
 * counts against it - wide enough to catch a hazard on a parallel side
 * street Mapbox's route geometry passes close to, narrow enough not to
 * penalize a route for something genuinely unrelated to it. */
export const HAZARD_CORRIDOR_METERS = 300;

/** How wide a radius around the driver's position counts as "nearby
 * enough to matter" when gathering manual/nearby reports for route
 * scoring - deliberately generous relative to HAZARD_CORRIDOR_METERS
 * (which then does the real, route-shaped filtering), just enough to skip
 * fetching truly irrelevant reports. */
export const HAZARD_GATHER_RADIUS_METERS = 6000;

/**
 * The same hazard set already visible on the map (RadarMap.tsx's
 * mapVisibleAlerts) and spoken as alerts - Waze's own alerts plus this
 * device's and nearby devices' manual reports, filtered by whichever
 * categories are currently enabled - gathered here independently since
 * this runs outside any component. Keeping route scoring and what the
 * driver already sees/hears in sync by construction, rather than building
 * a second, different notion of "hazard" just for routing.
 */
export function getHazardsForRouteScoring(driverPosition: GeoPoint, nowMs: number): RouteHazard[] {
  const trip = useTripStore.getState();
  const enabledTypes = enabledTypesFromSettings(useSettingsStore.getState().categoriesEnabled);
  const waze = trip.visibleAlerts.filter((alert) => enabledTypes.has(alert.type));
  const manual = visibleManualReportAlerts(trip.manualReports, driverPosition, nowMs, HAZARD_GATHER_RADIUS_METERS).filter(
    (alert) => enabledTypes.has(alert.type)
  );
  const nearby = visibleNearbyReportAlerts(trip.nearbyReports, driverPosition, nowMs, HAZARD_GATHER_RADIUS_METERS).filter(
    (alert) => enabledTypes.has(alert.type)
  );
  return [...waze, ...manual, ...nearby];
}

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
/**
 * Maps a driver-facing route choice onto the Mapbox Directions request
 * options (`exclude`, verified against Mapbox's current Directions v5 docs)
 * and the hazard-scoring flag scoreAndRankRoutes above already understands.
 * 'sidestreets' both excludes motorways from the request entirely and
 * scores the (necessarily non-motorway) alternatives by hazard exposure -
 * a driver picking backstreets almost always also wants the quieter one.
 */
export function routeTypeToRequestOptions(routeType: RouteType): { avoidHazards: boolean; exclude?: string } {
  switch (routeType) {
    case 'quickest':
      return { avoidHazards: false };
    case 'safest':
      return { avoidHazards: true };
    case 'sidestreets':
      return { avoidHazards: true, exclude: 'motorway' };
  }
}

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
