import { env } from '../../config/env';
import type { GeoPoint } from '../../geo/types';
import type { ManualReportCategory, RemoteFixedCamera, RemoteManualReport } from './types';

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
  category: ManualReportCategory;
  subtype: string | null;
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
      category: input.category,
      subtype: input.subtype,
    }),
  });
}

export async function fetchOwnReports(deviceId: string): Promise<RemoteManualReport[]> {
  return requestJson<RemoteManualReport[]>(`reports?deviceId=${encodeURIComponent(deviceId)}`);
}

export interface FetchNearbyReportsInput {
  deviceId: string;
  position: GeoPoint;
  radiusMeters: number;
}

/** Other devices' still-live reports near a position - excludes this
 * device's own reports (those already come from its own local state) and
 * anything the backend already considers aged out. */
export async function fetchNearbyReports(input: FetchNearbyReportsInput): Promise<RemoteManualReport[]> {
  const params = new URLSearchParams({
    deviceId: input.deviceId,
    lat: String(input.position.latitude),
    lng: String(input.position.longitude),
    radiusMeters: String(input.radiusMeters),
  });
  return requestJson<RemoteManualReport[]>(`reports?${params.toString()}`);
}

export interface ConfirmManualReportInput {
  id: string;
  deviceId: string;
}

/** "Still there?" - confirms another device's report, resetting its live
 * window. The backend rejects a device confirming its own report, and
 * silently no-ops a second confirmation from the same device. */
export async function confirmManualReport(input: ConfirmManualReportInput): Promise<RemoteManualReport> {
  return requestJson<RemoteManualReport>(`reports?id=${encodeURIComponent(input.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: input.deviceId }),
  });
}

export interface DeleteManualReportInput {
  id: string;
  deviceId: string;
}

/** Deletes one of this device's own reports - the backend's WHERE clause is
 * the entire ownership check (no accounts), so this can only ever delete
 * reports device_id itself created. */
export async function deleteManualReport(input: DeleteManualReportInput): Promise<void> {
  await requestJson<{ id: string }>(
    `reports?id=${encodeURIComponent(input.id)}&deviceId=${encodeURIComponent(input.deviceId)}`,
    { method: 'DELETE' }
  );
}

export async function fetchFixedCameras(): Promise<RemoteFixedCamera[]> {
  return requestJson<RemoteFixedCamera[]>('cameras');
}
