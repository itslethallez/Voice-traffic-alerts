import { env } from '../../config/env';
import type { GeoPoint } from '../../geo/types';

interface MapboxGeocodeContext {
  name: string;
}

interface MapboxGeocodeFeature {
  properties: {
    context?: {
      locality?: MapboxGeocodeContext;
      place?: MapboxGeocodeContext;
    };
  };
}

interface MapboxGeocodeResponse {
  features: MapboxGeocodeFeature[];
}

/**
 * Reverse-geocodes a point to its suburb via Mapbox's v6 reverse geocoding
 * endpoint. Verified against a real live call for a South Australian point
 * (Milne Rd, Modbury North): `context.locality.name` is the actual AU
 * suburb ("Modbury North"), while `context.place.name` ("Adelaide") is the
 * same coarse city-level name Waze's own `city` field already gives us -
 * kept only as a fallback for points where Mapbox has no locality (rural
 * areas).
 */
export async function fetchSuburbForPoint(
  point: GeoPoint,
  options: { signal?: AbortSignal } = {}
): Promise<string | null> {
  const url = new URL('https://api.mapbox.com/search/geocode/v6/reverse');
  url.searchParams.set('longitude', String(point.longitude));
  url.searchParams.set('latitude', String(point.latitude));
  url.searchParams.set('access_token', env.mapboxAccessToken);

  const response = await fetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error(`Mapbox reverse geocode request failed with status ${response.status}`);
  }

  const data = (await response.json()) as MapboxGeocodeResponse;
  const context = data.features[0]?.properties.context;
  return context?.locality?.name ?? context?.place?.name ?? null;
}
