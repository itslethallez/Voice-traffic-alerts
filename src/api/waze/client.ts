import { env } from '../../config/env';
import type { WazeAlertsResponse, WazeBoundingBox } from './types';

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

function formatCorner(corner: { lat: number; lon: number }): string {
  return `${corner.lat},${corner.lon}`;
}

export interface FetchWazeAlertsOptions {
  /** Capped at 200 by the API. Defaults to 200 (the max) per the task's "always request the max" rule. */
  maxAlerts?: number;
  /** We don't use jam segments in this app; defaults to 0 to skip fetching them. */
  maxJams?: number;
  signal?: AbortSignal;
}

export async function fetchWazeAlerts(
  box: WazeBoundingBox,
  { maxAlerts = 200, maxJams = 0, signal }: FetchWazeAlertsOptions = {}
): Promise<WazeAlertsResponse> {
  const url = new URL('alerts-and-jams', env.wazeApiBaseUrl);
  url.searchParams.set('bottom_left', formatCorner(box.bottomLeft));
  url.searchParams.set('top_right', formatCorner(box.topRight));
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
