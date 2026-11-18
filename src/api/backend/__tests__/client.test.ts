jest.mock('../../../config/env', () => ({
  env: { backendApiBaseUrl: 'https://shotgun-api.example.com/api/' },
}));

import { BackendApiError, deleteManualReport, fetchFixedCameras, fetchOwnReports, submitManualReport } from '../client';

const originalFetch = globalThis.fetch;

function mockFetchOnce(response: Partial<Response> & { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: response.json ?? (() => Promise.resolve(undefined)),
  } as Response);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('submitManualReport', () => {
  it('POSTs the report shape the server expects and returns the parsed row', async () => {
    const remoteReport = { id: 'r1', createdAt: '2026-01-01T00:00:00.000Z', category: 'POLICE', subtype: null, lat: -34.9, lng: 138.6, headingDeg: 90, note: null, confidence: 1, corroborationCount: 0 };
    mockFetchOnce({ ok: true, json: () => Promise.resolve(remoteReport) });

    const result = await submitManualReport({
      deviceId: 'device-1',
      position: { latitude: -34.9, longitude: 138.6 },
      headingDeg: 90,
      category: 'POLICE',
      subtype: 'POLICE_VISIBLE',
    });

    expect(result).toEqual(remoteReport);
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://shotgun-api.example.com/api/reports');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      deviceId: 'device-1',
      lat: -34.9,
      lng: 138.6,
      headingDeg: 90,
      category: 'POLICE',
      subtype: 'POLICE_VISIBLE',
    });
  });

  it('throws a BackendApiError with isRateLimited when the server returns 429', async () => {
    mockFetchOnce({ ok: false, status: 429 });

    await expect(
      submitManualReport({
        deviceId: 'device-1',
        position: { latitude: -34.9, longitude: 138.6 },
        headingDeg: null,
        category: 'ACCIDENT',
        subtype: null,
      })
    ).rejects.toMatchObject({ name: 'BackendApiError', status: 429, isRateLimited: true });
  });

  it('throws a BackendApiError (not isRateLimited) on a network failure', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    await expect(
      submitManualReport({
        deviceId: 'device-1',
        position: { latitude: -34.9, longitude: 138.6 },
        headingDeg: null,
        category: 'ACCIDENT',
        subtype: null,
      })
    ).rejects.toMatchObject({ name: 'BackendApiError', status: null, isRateLimited: false });
  });
});

describe('deleteManualReport', () => {
  it('sends a DELETE request keyed by report id and device id', async () => {
    mockFetchOnce({ ok: true, json: () => Promise.resolve({ id: 'r1' }) });

    await deleteManualReport({ id: 'r1', deviceId: 'device-1' });

    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://shotgun-api.example.com/api/reports?id=r1&deviceId=device-1');
    expect(init.method).toBe('DELETE');
  });

  it('throws a BackendApiError when the server rejects the delete', async () => {
    mockFetchOnce({ ok: false, status: 404 });

    await expect(deleteManualReport({ id: 'r1', deviceId: 'device-1' })).rejects.toMatchObject({
      name: 'BackendApiError',
      status: 404,
    });
  });
});

describe('fetchOwnReports', () => {
  it('requests this device\'s reports by query string', async () => {
    mockFetchOnce({ ok: true, json: () => Promise.resolve([]) });
    await fetchOwnReports('device-1');
    const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://shotgun-api.example.com/api/reports?deviceId=device-1');
  });
});

describe('fetchFixedCameras', () => {
  it('requests the cameras endpoint and returns the parsed array', async () => {
    const cameras = [{ id: 'sapol-1', lat: -34.9, lng: 138.6, roadName: 'Test Rd', cameraType: 'fixed', source: 'sapol', lastSyncedAt: '2026-01-01T00:00:00.000Z' }];
    mockFetchOnce({ ok: true, json: () => Promise.resolve(cameras) });

    const result = await fetchFixedCameras();

    expect(result).toEqual(cameras);
    const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://shotgun-api.example.com/api/cameras');
  });
});

describe('BackendApiError', () => {
  it('marks isRateLimited only for a 429 status', () => {
    expect(new BackendApiError('x', 429).isRateLimited).toBe(true);
    expect(new BackendApiError('x', 500).isRateLimited).toBe(false);
    expect(new BackendApiError('x', null).isRateLimited).toBe(false);
  });
});
