import type { WazeBoundingBoxParams } from '../../geo/boundingBox';
import { splitBoundingBoxIntoQuadrants } from '../../geo/quadrants';
import { WazeApiError, fetchWazeAlerts } from './client';
import { mergeAlertsById } from './mergeAlerts';
import type { WazeAlert } from './types';

const ALERTS_PER_CALL_CAP = 200;

export interface BoundingBoxFetchResult {
  alerts: WazeAlert[];
  /**
   * True if at least one quadrant request came back 429 rate-limited.
   * The call as a whole still "succeeds" (the original 200 plus whatever
   * quadrants did return are merged and returned) but the caller needs
   * this to keep treating the API as rate-limited for backoff purposes,
   * rather than seeing a full alerts list and assuming everything is clear.
   */
  quadrantRateLimited: boolean;
}

/**
 * A single call is capped at 200 alerts. Returning exactly the cap is
 * the signal that the area may hold more than that - there's no
 * "totalCount" field to check instead - so this splits into four
 * quadrants, queries each, and merges + dedupes by alert_id rather than
 * silently dropping whatever didn't fit in the first response. Only one
 * level of splitting, matching the spec ("split into four quadrants"),
 * not a recursive tiling if a quadrant itself hits the cap.
 *
 * The four quadrant calls are best-effort on top of the already-successful
 * full-box response: if one quadrant fails (network blip, rate limit) the
 * others' alerts - and the original 200 - still get merged and returned,
 * rather than the whole call rejecting and discarding data already in
 * hand. Only rejects if every call, including the initial one, fails.
 */
export async function fetchAlertsForBoundingBox(
  box: WazeBoundingBoxParams
): Promise<BoundingBoxFetchResult> {
  const response = await fetchWazeAlerts(box, { maxAlerts: ALERTS_PER_CALL_CAP });
  if (response.data.alerts.length < ALERTS_PER_CALL_CAP) {
    return { alerts: response.data.alerts, quadrantRateLimited: false };
  }

  const quadrants = splitBoundingBoxIntoQuadrants(box);
  const quadrantResults = await Promise.allSettled(
    quadrants.map((quadrant) => fetchWazeAlerts(quadrant, { maxAlerts: ALERTS_PER_CALL_CAP }))
  );

  const quadrantAlertLists: WazeAlert[][] = [];
  let quadrantRateLimited = false;
  for (const result of quadrantResults) {
    if (result.status === 'fulfilled') {
      quadrantAlertLists.push(result.value.data.alerts);
    } else {
      console.warn('[waze] a quadrant request failed, continuing with the rest', result.reason);
      if (result.reason instanceof WazeApiError && result.reason.isRateLimited) {
        quadrantRateLimited = true;
      }
    }
  }

  return {
    alerts: mergeAlertsById([response.data.alerts, ...quadrantAlertLists]),
    quadrantRateLimited,
  };
}
