/** Mapbox zoom is unbounded in theory but meaningless this far out or in
 * for a driving app - clamps protect against extreme settings values or an
 * edge-case latitude producing a nonsensical zoom. Used by RadarMap's
 * zoom-out/zoom-in focus transition to clamp the pulled-back zoom. */
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 18;
