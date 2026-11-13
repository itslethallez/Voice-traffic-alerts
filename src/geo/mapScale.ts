import { destinationPoint } from './destination';
import type { GeoPoint } from './types';

const EARTH_RADIUS_METERS = 6_378_137;
const MAPBOX_TILE_SIZE_PX = 512;

/** A closed polygon ring in GeoJSON's [longitude, latitude] order. The
 * points are calculated geodesically, so its radius remains in real metres
 * rather than drifting with latitude or map zoom. */
export function awarenessCircleCoordinates(
  center: GeoPoint,
  radiusMeters: number,
  segments = 48
): [number, number][] {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0 || !Number.isInteger(segments) || segments < 3) return [];

  const coordinates: [number, number][] = [];
  for (let index = 0; index <= segments; index += 1) {
    const point = destinationPoint(center, radiusMeters, (index / segments) * 360);
    coordinates.push([point.longitude, point.latitude]);
  }
  return coordinates;
}

export interface AwarenessZoomOptions {
  latitude: number;
  radiusMeters: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Fraction of the smaller map dimension occupied by the circle diameter. */
  coverage?: number;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Returns the Web Mercator zoom at which the driver's full warning-distance
 * circle occupies a stable portion of the map. This makes the circle a true
 * scale indicator: changing the "Warn me from" setting resizes both the
 * geographic circle and the camera view together.
 */
export function awarenessZoomLevel({
  latitude,
  radiusMeters,
  viewportWidth,
  viewportHeight,
  coverage = 0.78,
  minZoom = 3,
  maxZoom = 18,
}: AwarenessZoomOptions): number {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(radiusMeters) ||
    radiusMeters <= 0 ||
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    !Number.isFinite(coverage) ||
    coverage <= 0
  ) {
    return maxZoom;
  }

  const latitudeRadians = (latitude * Math.PI) / 180;
  const availablePixels = Math.min(viewportWidth, viewportHeight) * Math.min(coverage, 1);
  const diameterMeters = radiusMeters * 2;
  const zoom = Math.log2(
    (Math.cos(latitudeRadians) * 2 * Math.PI * EARTH_RADIUS_METERS * availablePixels) /
      (MAPBOX_TILE_SIZE_PX * diameterMeters)
  );

  return Math.max(minZoom, Math.min(maxZoom, zoom));
}
