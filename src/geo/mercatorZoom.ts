const WEB_MERCATOR_CONSTANT = 156543.03392;

/** Mapbox zoom is unbounded in theory but meaningless this far out or in
 * for a driving app - clamps protect against extreme settings values
 * (announceDistanceMeters up to 20km) or an edge-case latitude producing a
 * nonsensical zoom. Exported so other camera-zoom math (e.g. RadarMap's
 * zoom-out/zoom-in focus transition) clamps to the same bounds instead of
 * duplicating them. */
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 18;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * The Mapbox Camera zoom level at which a screen-space circle of radius
 * `ringRadiusPx`, centered at `latitudeDeg`, represents `distanceMeters` of
 * real-world ground distance. Derived from the standard Web Mercator
 * metres-per-pixel formula (metersPerPixel = WEB_MERCATOR_CONSTANT *
 * cos(lat) / 2^zoom) solved for zoom.
 */
export function zoomForRingRadius(
  distanceMeters: number,
  ringRadiusPx: number,
  latitudeDeg: number
): number {
  const latRad = toRadians(latitudeDeg);
  const zoom = Math.log2((WEB_MERCATOR_CONSTANT * Math.cos(latRad) * ringRadiusPx) / distanceMeters);
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}
