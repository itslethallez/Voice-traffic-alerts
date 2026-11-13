import { env } from '../../config/env';
import type { WazeBoundingBoxParams } from '../../geo/boundingBox';
import type { WazeAlertsResponse } from './types';

export class WazeApiError extends Error {
  status: number | null;
  isRateLimited: boolean;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'WazeApiError';
    this.status = status;
    this.isRateLimited = status === 429;
  }
}

export interface FetchWazeAlertsOptions {
  /** Capped at 200 by the API. Defaults to 200 (the max) per the task's "always request the max" rule. */
  maxAlerts?: number;
  /** We don't use jam segments in this app; defaults to 0 to skip fetching them. */
  maxJams?: number;
  signal?: AbortSignal;
}

/**
 * `box` is already in the "lat,lon" string format the endpoint expects
 * (see geo/boundingBox.ts's WazeBoundingBoxParams) - geo/boundingBox.ts,
 * geo/radiusBoundingBox.ts and engine/pollPlanner.ts all produce it
 * directly, so no conversion happens here.
 */
export async function fetchWazeAlerts(
  box: WazeBoundingBoxParams,
  { maxAlerts = 200, maxJams = 0, signal }: FetchWazeAlertsOptions = {}
): Promise<WazeAlertsResponse> {
  const url = new URL('alerts-and-jams', env.wazeApiBaseUrl);
  url.searchParams.set('bottom_left', box.bottom_left);
  url.searchParams.set('top_right', box.top_right);
  url.searchParams.set('max_alerts', String(maxAlerts));
  url.searchParams.set('max_jams', String(maxJams));

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { 'x-api-key': env.wazeApiKey },
      signal,
    });
  } catch {
    throw new WazeApiError('Network request to the Waze API failed', null);
  }

  if (!response.ok) {
    throw new WazeApiError(
      `Waze API request failed with status ${response.status}`,
      response.status
    );
  }

  return (await response.json()) as WazeAlertsResponse;
}
