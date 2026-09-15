jest.mock('../../../config/env', () => ({
  env: { mapboxAccessToken: 'test-token' },
}));

import { fetchDirections, fetchGeocode, MapboxApiError } from '../client';
import type { MapboxDirectionsResponse, MapboxGeocodeResponse } from '../types';

function makeFetchResponse(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const ORIGIN = { latitude: -34.9285, longitude: 138.6007 };
const DESTINATION = { latitude: -34.9155556, longitude: 138.5961111 };

const OK_DIRECTIONS_BODY: MapboxDirectionsResponse = {
  code: 'Ok',
  waypoints: [
    { location: [138.6007, -34.9285], name: 'origin' },
    { location: [138.5961111, -34.9155556], name: 'destination' },
  ],
  routes: [
    {
      geometry: { type: 'LineString', coordinates: [[138.6007, -34.9285], [138.5961111, -34.9155556]] },
      legs: [{ steps: [], distance: 1200, duration: 180, summary: 'North Terrace' }],
      distance: 1200,
      duration: 180,
      weight: 180,
      weight_name: 'routability',
    },
  ],
};

describe('fetchDirections', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  it('requests alternatives/geojson/steps and returns the parsed body on success', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, 200, OK_DIRECTIONS_BODY));

    const result = await fetchDirections([ORIGIN, DESTINATION]);

    expect(result).toEqual(OK_DIRECTIONS_BODY);
    const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toContain('138.6007,-34.9285;138.5961111,-34.9155556');
    expect(parsed.searchParams.get('alternatives')).toBe('true');
    expect(parsed.searchParams.get('geometries')).toBe('geojson');
    expect(parsed.searchParams.get('steps')).toBe('true');
    expect(parsed.searchParams.get('access_token')).toBe('test-token');
  });

  it('throws MapboxApiError with the status on a non-ok HTTP response', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(false, 422, { code: 'NoRoute' }));

    await expect(fetchDirections([ORIGIN, DESTINATION])).rejects.toMatchObject({
      name: 'MapboxApiError',
      status: 422,
    });
  });

  it('throws MapboxApiError when the body code is not Ok despite a 200', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      makeFetchResponse(true, 200, { code: 'NoRoute', routes: [], waypoints: [] })
    );

    await expect(fetchDirections([ORIGIN, DESTINATION])).rejects.toThrow(MapboxApiError);
  });

  it('marks a 429 as rate limited', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(false, 429, {}));

    try {
      await fetchDirections([ORIGIN, DESTINATION]);
      throw new Error('expected fetchDirections to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(MapboxApiError);
      expect((error as MapboxApiError).isRateLimited).toBe(true);
    }
  });

  it('throws a status-less MapboxApiError on a network failure', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValue(new Error('network down'));

    await expect(fetchDirections([ORIGIN, DESTINATION])).rejects.toMatchObject({
      name: 'MapboxApiError',
      status: null,
    });
  });
});

describe('fetchGeocode', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  it('sends the query, proximity, and access token, and returns features', async () => {
    const body: MapboxGeocodeResponse = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [138.6, -34.9] },
          properties: { full_address: '1 Main St, Adelaide' },
        },
      ],
    };
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, 200, body));

    const features = await fetchGeocode('Main St', { proximity: ORIGIN });

    expect(features).toEqual(body.features);
    const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('q')).toBe('Main St');
    expect(parsed.searchParams.get('proximity')).toBe('138.6007,-34.9285');
    expect(parsed.searchParams.get('access_token')).toBe('test-token');
  });

  it('returns an empty array rather than throwing when there are no features', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      makeFetchResponse(true, 200, { type: 'FeatureCollection', features: [] })
    );
    await expect(fetchGeocode('nonsense query')).resolves.toEqual([]);
  });
});
