import type { WazeAlert } from '../api/waze/types';
import { haversineDistance } from '../geo/distance';
import type { GeoPoint } from '../geo/types';

export interface CurrentReport {
  alert: WazeAlert;
  distanceMeters: number;
}

/** Keeps the report feed aligned with the map while presenting the most
 * useful item first: every supplied live alert is retained and ordered by
 * straight-line distance from the driver's latest position. */
export function sortCurrentReportsByDistance(
  alerts: readonly WazeAlert[],
  driverPosition: GeoPoint | null
): CurrentReport[] {
  if (!driverPosition) return [];

  return alerts
    .map((alert) => ({
      alert,
      distanceMeters: haversineDistance(driverPosition, {
        latitude: alert.latitude,
        longitude: alert.longitude,
      }),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}
