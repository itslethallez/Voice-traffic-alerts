import { env } from '../../config/env';
import type { GeoPoint } from '../../geo/types';
import type { RemoteFixedCamera, RemoteManualReport } from './types';

export class BackendApiError extends Error {
  status: number | null;
  isRateLimited: boolean;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'BackendApiError';
    this.status = status;
    this.isRateLimited = status === 429;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = new URL(path, env.backendApiBaseUrl);

  let response: Response;
  try {
    response = await fetch(url.toString(), init);
  } catch {
    throw new BackendApiError(`Network request to the backend API failed (${path})`, null);
  }

  if (!response.ok) {
    throw new BackendApiError(`Backend API request failed with status ${response.status} (${path})`, response.status);
  }

  return (await response.json()) as T;
}

export interface SubmitManualReportInput {
  deviceId: string;
  position: GeoPoint;
  headingDeg: number | null;
}

export async function submitManualReport(input: SubmitManualReportInput): Promise<RemoteManualReport> {
  return requestJson<RemoteManualReport>('reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId: input.deviceId,
      lat: input.position.latitude,
      lng: input.position.longitude,
      headingDeg: input.headingDeg,
    }),
  });
}

export async function fetchOwnReports(deviceId: string): Promise<RemoteManualReport[]> {
  return requestJson<RemoteManualReport[]>(`reports?deviceId=${encodeURIComponent(deviceId)}`);
}

export async function fetchFixedCameras(): Promise<RemoteFixedCamera[]> {
  return requestJson<RemoteFixedCamera[]>('cameras');
}
