import type { GeoPoint } from './types';

/**
 * "lat,lon" - the order confirmed against real sample requests/responses
 * from the alerts-and-jams endpoint (see README's "Waze API" section).
 * Getting this order backwards doesn't error, it just silently returns
 * an empty alerts array.
 */
export function formatCorner(point: GeoPoint): string {
  return `${point.latitude},${point.longitude}`;
}
