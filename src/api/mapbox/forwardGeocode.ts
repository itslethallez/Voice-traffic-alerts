import { env } from '../../config/env';
import type { GeoPoint } from '../../geo/types';

interface MapboxForwardGeocodeFeature {
  properties: {
    coordinates: {
      longitude: number;
      latitude: number;
    };
  };
}

interface MapboxForwardGeocodeResponse {
  features: MapboxForwardGeocodeFeature[];
}

/**
 * Forward-geocodes a free-text address to a point via Mapbox's v6 geocoding
 * endpoint - the counterpart to reverseGeocode.ts's point-to-suburb lookup.
 * Used only by scripts/buildFixedCameraDataset.js to turn SAPOL's street
 * addresses into coordinates once, offline - never called at app runtime.
 */
export async function fetchForwardGeocode(address: string): Promise<GeoPoint | null> {
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('q', address);
  url.searchParams.set('access_token', env.mapboxAccessToken);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Mapbox forward geocode request failed with status ${response.status}`);
  }

  const data = (await response.json()) as MapboxForwardGeocodeResponse;
  const coordinates = data.features[0]?.properties.coordinates;
  return coordinates ? { latitude: coordinates.latitude, longitude: coordinates.longitude } : null;
}
