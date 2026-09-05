import { haversineDistance } from './distance';
import type { GeoPoint } from './types';

/** Minimal location shape shared by Waze alerts and manual-report map markers. */
export interface LocatedAlert {
  latitude: number;
  longitude: number;
}

/**
 * Finds the closest alert the map is already permitted to display. This is
 * intentionally not heading- or voice-gated: the map gives the driver a full
 * local picture, while speech keeps its stricter ahead-and-in-range filter.
 */
export function nearestAlertToDriver<T extends LocatedAlert>(alerts: readonly T[], driverPosition: GeoPoint | null): T | null {
  if (!driverPosition || alerts.length === 0) return null;

  let closest: T | null = null;
  let closestDistanceMeters = Number.POSITIVE_INFINITY;
  for (const alert of alerts) {
    const distanceMeters = haversineDistance(driverPosition, alert);
    if (distanceMeters < closestDistanceMeters) {
      closest = alert;
      closestDistanceMeters = distanceMeters;
    }
  }
  return closest;
}
