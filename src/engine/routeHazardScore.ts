import type { WazeAlertType } from '../api/waze/types';
import { distanceToPolyline } from '../geo/routePolyline';
import type { GeoPoint } from '../geo/types';
import { SEVERITY_ORDER } from './constants';

/** Minimal shape any hazard-like alert needs for route scoring - matches
 * WazeAlert's own top-level latitude/longitude/type fields directly, and
 * is exactly what RadarMap.tsx's mapVisibleAlerts already produces (Waze
 * alerts plus this device's and nearby devices' manual reports, already
 * merged into one WazeAlert-shaped array) - so route scoring sees the same
 * hazard set the driver already sees on the map and hears about. */
export interface RouteHazard {
  latitude: number;
  longitude: number;
  type: WazeAlertType;
}

export interface HazardNearRoute<T extends RouteHazard> {
  hazard: T;
  distanceMeters: number;
}

/** Every hazard within `corridorMeters` of any point on `polyline`, nearest first. */
export function hazardsNearRoute<T extends RouteHazard>(
  polyline: readonly GeoPoint[],
  hazards: readonly T[],
  corridorMeters: number
): HazardNearRoute<T>[] {
  const results: HazardNearRoute<T>[] = [];
  for (const hazard of hazards) {
    const distanceMeters = distanceToPolyline({ latitude: hazard.latitude, longitude: hazard.longitude }, polyline);
    if (distanceMeters <= corridorMeters) {
      results.push({ hazard, distanceMeters });
    }
  }
  return results.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/** SEVERITY_ORDER's first entry (ACCIDENT) is the most severe - inverted
 * here so the most severe type contributes the most to a route's score. */
function severityWeight(type: WazeAlertType): number {
  const index = SEVERITY_ORDER.indexOf(type);
  const rank = index === -1 ? SEVERITY_ORDER.length : index;
  return SEVERITY_ORDER.length - rank;
}

/**
 * Severity-weighted hazard exposure for one candidate route - higher means
 * worse (more, and more severe, hazards near this route). Used to rank
 * Mapbox's alternative routes when avoidHazards is on: not a guarantee any
 * given route dodges every hazard (Mapbox's Directions API has no
 * arbitrary avoid-point support to request that server-side), just a way
 * to prefer whichever candidate is least exposed.
 */
export function scoreRouteHazardExposure<T extends RouteHazard>(
  polyline: readonly GeoPoint[],
  hazards: readonly T[],
  corridorMeters: number
): number {
  return hazardsNearRoute(polyline, hazards, corridorMeters).reduce(
    (total, { hazard }) => total + severityWeight(hazard.type),
    0
  );
}
