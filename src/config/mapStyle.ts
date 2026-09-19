import shotgunMapStyle from './shotgun-map-style.json';

/**
 * The map's base style is the bundled "Shotgun Night" style - a stripped,
 * repaletted copy of navigation-night-v1 (see the file next to this one,
 * which is also the artifact to upload into Mapbox Studio if the style
 * should ever be hosted/edited there). The bundle already carries the §8
 * treatment: clutter layers removed (MAP_STYLE_STRIP_LAYERS), charcoal
 * land/water, teal road hierarchy, DIN Pro labels (the closest Mapbox-
 * hosted face to Rajdhani - a true font swap needs a Studio font upload).
 *
 * Setting EXPO_PUBLIC_MAPBOX_STYLE_URL overrides the bundle with a
 * mapbox:// (or http(s)) style URL - e.g. once a Studio-hosted copy
 * exists so style tweaks ship without an app release.
 */
export const MAP_STYLE_URL = process.env.EXPO_PUBLIC_MAPBOX_STYLE_URL ?? null;

/** The bundled style as a parsed object (mapbox-gl `style` option). */
export const MAP_STYLE_OBJECT = shotgunMapStyle;

/** The bundled style as a JSON string (@rnmapbox MapView `styleJSON`). */
export const MAP_STYLE_JSON = JSON.stringify(shotgunMapStyle);

/** Layer ids removed from navigation-night-v1 to reach the §8 "minimal
 * labels" map: Mapbox's own incident system (competes with our alerts),
 * turn/crossing symbols, every non-road label (POI icons, suburbs, states,
 * water, nature), boundaries, and off-road line work. The bundled style
 * already lacks them - the web adapter also applies the list at runtime so
 * the override URL still declutters if it ever points at the stock style.
 * Keep in sync with shotgun-map-style.json. */
export const MAP_STYLE_STRIP_LAYERS = [
  'incident-closure-lines-navigation',
  'incident-closure-line-highlights-navigation',
  'incident-endpoints-navigation',
  'incident-startpoints-navigation',
  'turning-feature-outline-navigation',
  'turning-feature-navigation',
  'road-intersection',
  'level-crossing-navigation',
  'traffic-level-crossing-navigation',
  'ferry-aerialway-label',
  'waterway-label',
  'natural-line-label',
  'natural-point-label',
  'water-line-label',
  'water-point-label',
  'poi-label',
  'airport-label',
  'settlement-subdivision-label',
  'settlement-minor-label',
  'settlement-major-label',
  'state-label',
  'country-label',
  'road-number-shield-navigation',
  'road-exit-shield-navigation',
  'admin-1-boundary-bg',
  'admin-0-boundary-bg',
  'admin-1-boundary',
  'admin-0-boundary',
  'admin-0-boundary-disputed',
  'aerialway',
  'ferry',
  'ferry-auto',
] as const;
