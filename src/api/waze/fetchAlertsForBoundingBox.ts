import type { WazeBoundingBoxParams } from '../../geo/boundingBox';
import { splitBoundingBoxIntoQuadrants } from '../../geo/quadrants';
import { fetchWazeAlerts } from './client';
import { mergeAlertsById } from './mergeAlerts';
import type { WazeAlert } from './types';

const ALERTS_PER_CALL_CAP = 200;

/**
 * A single call is capped at 200 alerts. Returning exactly the cap is
 * the signal that the area may hold more than that - there's no
 * "totalCount" field to check instead - so this splits into four
 * quadrants, queries each, and merges + dedupes by alert_id rather than
 * silently dropping whatever didn't fit in the first response. Only one
 * level of splitting, matching the spec ("split into four quadrants"),
 * not a recursive tiling if a quadrant itself hits the cap.
 */
export async function fetchAlertsForBoundingBox(box: WazeBoundingBoxParams): Promise<WazeAlert[]> {
  const response = await fetchWazeAlerts(box, { maxAlerts: ALERTS_PER_CALL_CAP });
  if (response.data.alerts.length < ALERTS_PER_CALL_CAP) {
    return response.data.alerts;
  }

  const quadrants = splitBoundingBoxIntoQuadrants(box);
  const quadrantResponses = await Promise.all(
    quadrants.map((quadrant) => fetchWazeAlerts(quadrant, { maxAlerts: ALERTS_PER_CALL_CAP }))
  );

  return mergeAlertsById([
    response.data.alerts,
    ...quadrantResponses.map((quadrantResponse) => quadrantResponse.data.alerts),
  ]);
}
