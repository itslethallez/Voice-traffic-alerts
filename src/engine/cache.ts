import type { WazeAlert } from '../api/waze/types';
import type { AlertsCache } from './types';

export const initialAlertsCache: AlertsCache = {
  alerts: [],
  fetchedAtMs: null,
  isStale: false,
};

export type FetchResult =
  | { ok: true; alerts: WazeAlert[]; nowMs: number }
  | { ok: false };

/**
 * Pure reducer for "cache the last successful response; on a network
 * failure keep serving from cache and never crash the loop." A failed
 * fetch never clears the cache, it only flags it stale.
 */
export function applyFetchResult(prev: AlertsCache, result: FetchResult): AlertsCache {
  if (result.ok) {
    return { alerts: result.alerts, fetchedAtMs: result.nowMs, isStale: false };
  }
  return { ...prev, isStale: true };
}
