import { fetchSuburbForPoint } from '../api/mapbox/reverseGeocode';
import { env } from '../config/env';
import type { GeoPoint } from './types';

/** ~100m grid - fine enough that a suburb's alerts collapse onto one cache
 * entry, coarse enough that repeat polls over the same stretch of road
 * don't each trigger a fresh Mapbox request. */
const QUANTIZE_DECIMALS = 3;

const REQUEST_TIMEOUT_MS = 5000;

function quantizeKey(point: GeoPoint): string {
  return `${point.latitude.toFixed(QUANTIZE_DECIMALS)},${point.longitude.toFixed(QUANTIZE_DECIMALS)}`;
}

/** undefined = never attempted, null = attempted, no suburb found (or the
 * lookup failed), string = resolved suburb. */
const suburbCache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<void>>();

/** Synchronous read - safe to call from formatAnnouncement.ts's pure,
 * synchronous formatting functions. */
export function getCachedSuburb(point: GeoPoint): string | null | undefined {
  return suburbCache.get(quantizeKey(point));
}

/**
 * Fire-and-forget prefetch: kicks off a reverse-geocode request for this
 * point if one isn't already cached or in flight, and stores the result
 * (or null, on any failure/timeout) once it lands. Callers in app code
 * never await this; tests can await it directly with reverseGeocode mocked.
 */
export function prefetchSuburb(point: GeoPoint): Promise<void> {
  if (!env.mapboxAccessToken) return Promise.resolve();

  const key = quantizeKey(point);
  if (suburbCache.has(key)) return Promise.resolve();

  const existing = inFlight.get(key);
  if (existing) return existing;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const request = fetchSuburbForPoint(point, { signal: controller.signal })
    .then((suburb) => {
      suburbCache.set(key, suburb);
    })
    .catch(() => {
      suburbCache.set(key, null);
    })
    .finally(() => {
      clearTimeout(timeout);
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}
