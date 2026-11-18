import { fetchSpeedLimitNear } from '../api/osm/roadSpeedLimit';
import type { GeoPoint } from './types';

/** Same ~100m grid as suburbLookup.ts, for the same reason: coalesces
 * nearby lookups and repeat polls over the same stretch of road onto one
 * Overpass request. */
const QUANTIZE_DECIMALS = 3;

const REQUEST_TIMEOUT_MS = 5000;

function quantizeKey(point: GeoPoint): string {
  return `${point.latitude.toFixed(QUANTIZE_DECIMALS)},${point.longitude.toFixed(QUANTIZE_DECIMALS)}`;
}

/** undefined = never attempted, null = attempted, no major road found nearby
 * (or the lookup failed), number = resolved speed limit in km/h. */
const speedLimitCache = new Map<string, number | null>();
const inFlight = new Map<string, Promise<void>>();

/** Synchronous read - safe to call from the pure, synchronous
 * selectSpeedCameraWarning.ts. */
export function getCachedSpeedLimit(point: GeoPoint): number | null | undefined {
  return speedLimitCache.get(quantizeKey(point));
}

/**
 * Fire-and-forget prefetch, same shape as suburbLookup.ts's
 * prefetchSuburb: no-ops if already cached or in flight, otherwise queries
 * Overpass with a timeout and caches the result (or null, on any
 * failure/timeout - never left unresolved forever). Callers never await
 * this in app code (tripRuntime.ts only bothers calling it when a nearby
 * warning target already exists, to keep Overpass usage rare); tests can
 * await it directly with roadSpeedLimit mocked.
 */
export function prefetchSpeedLimit(point: GeoPoint): Promise<void> {
  const key = quantizeKey(point);
  if (speedLimitCache.has(key)) return Promise.resolve();

  const existing = inFlight.get(key);
  if (existing) return existing;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const request = fetchSpeedLimitNear(point, { signal: controller.signal })
    .then((speedLimitKmh) => {
      speedLimitCache.set(key, speedLimitKmh);
    })
    .catch(() => {
      speedLimitCache.set(key, null);
    })
    .finally(() => {
      clearTimeout(timeout);
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}
