import type { GeoPoint } from './types';

/**
 * Terrain-drape legibility fix. With a DEM terrain active, Mapbox renders
 * every non-elevated line layer (roads) draped onto the terrain mesh - so
 * in genuinely flat areas like the Adelaide CBD, a few metres of DEM
 * ripple shows up as visibly wavy straight roads at driving zoom/pitch.
 * Exaggeration is global (no per-tile or per-location expression), so the
 * fix is to scale it by the relief actually measured around the driver:
 * ~flat where there's nothing real to show, full relief in the hills.
 *
 * Sampling the terrain source itself (queryTerrainElevation) means the
 * measurement is the same data the renderer drapes with, so DEM noise
 * counts toward the spread exactly as much as it displaces the roads.
 */

/** Ring radius for relief sampling - roughly the distance the driver can
 * actually see ahead at cruising zooms, so the scale reflects the terrain
 * on screen, not the region in general. */
export const TERRAIN_RELIEF_SAMPLE_RADIUS_M = 900;
/** Only resample once the driver has moved this far - relief is a slow
 * signal and each sample is a ring of elevation queries. */
export const TERRAIN_RELIEF_RESAMPLE_DISTANCE_M = 600;

/** At or below this measured relief the terrain is treated as flat:
 * exaggeration bottoms out at MIN_EXAGGERATION_SCALE, which shrinks DEM
 * ripple to sub-pixel displacement - straight roads render straight.
 * Chosen against real DEM samples: Adelaide CBD reads ~8-24m of local
 * spread, Stirling/Katoomba foothills read 40-160m. */
export const TERRAIN_RELIEF_FLAT_M = 20;
/** At or above this measured relief the full 3D-guide exaggeration
 * applies. Between FLAT and HILLY the scale ramps linearly. */
export const TERRAIN_RELIEF_HILLY_M = 80;
/** Never exactly 0 - keeps the map technically terrain-enabled (labels,
 * extrusions and the DEM source keep working identically) and leaves a
 * whisper of genuine micro-relief rather than a hard binary switch. */
export const MIN_EXAGGERATION_SCALE = 0.12;

/**
 * Center + 8-point ring (N/NE/E/SE/S/SW/W/NW) around `center`. A plain
 * equirectangular offset is fine at ~1km distances.
 */
export function reliefSamplePoints(center: GeoPoint, radiusM: number = TERRAIN_RELIEF_SAMPLE_RADIUS_M): GeoPoint[] {
  const latMetersPerDeg = 111_320;
  const lonMetersPerDeg = latMetersPerDeg * Math.cos((center.latitude * Math.PI) / 180);
  const points: GeoPoint[] = [center];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    points.push({
      latitude: center.latitude + (Math.cos(angle) * radiusM) / latMetersPerDeg,
      longitude: center.longitude + (Math.sin(angle) * radiusM) / lonMetersPerDeg,
    });
  }
  return points;
}

/**
 * Robust relief of a set of elevation samples: the spread after dropping
 * the single lowest and single highest reading. One bad DEM sample (a
 * spike or a hole) shouldn't flip a flat city to "hilly", and trimming
 * both ends keeps the metric symmetric.
 */
export function trimmedReliefM(elevations: readonly number[]): number {
  const sorted = [...elevations].sort((a, b) => a - b);
  const trimmed = sorted.length > 2 ? sorted.slice(1, -1) : sorted;
  return trimmed[trimmed.length - 1] - trimmed[0];
}

/** Maps measured local relief to the terrain-exaggeration multiplier. */
export function exaggerationScaleForRelief(reliefM: number): number {
  if (!Number.isFinite(reliefM)) return 1;
  const t = Math.min(1, Math.max(0, (reliefM - TERRAIN_RELIEF_FLAT_M) / (TERRAIN_RELIEF_HILLY_M - TERRAIN_RELIEF_FLAT_M)));
  return MIN_EXAGGERATION_SCALE + t * (1 - MIN_EXAGGERATION_SCALE);
}

/** The 3D-guide base exaggeration curve (before the relief scale is
 * folded in). Shared by both adapters so the normalisation below uses the
 * same numbers the style applies. */
export const TERRAIN_EXAGGERATION_CURVE = {
  midZoom: 10,
  midValue: 1.6,
  cityZoom: 14,
  cityValue: 1.0,
} as const;

/** Base (unscaled) exaggeration the zoom-interpolated curve yields at
 * `zoom` - the interpolation clamps outside [midZoom, cityZoom]. */
export function baseExaggerationAtZoom(zoom: number): number {
  const { midZoom, midValue, cityZoom, cityValue } = TERRAIN_EXAGGERATION_CURVE;
  if (zoom <= midZoom) return midValue;
  if (zoom >= cityZoom) return cityValue;
  return midValue + ((zoom - midZoom) / (cityZoom - midZoom)) * (cityValue - midValue);
}

/** Style expression for the zoom-interpolated exaggeration curve with the
 * relief scale folded in. Returned untyped so the geo module stays free of
 * mapbox/rnmapbox type imports; both adapters cast at the call site. */
export function scaledExaggerationExpression(scale: number): unknown[] {
  const { midZoom, midValue, cityZoom, cityValue } = TERRAIN_EXAGGERATION_CURVE;
  return ['interpolate', ['linear'], ['zoom'], midZoom, midValue * scale, cityZoom, cityValue * scale];
}

/**
 * queryTerrainElevation returns *exaggerated* heights - the renderer's
 * applied exaggeration multiplies the DEM value. Left uncorrected, a flat
 * area's scale would corrupt the next measurement (hills measured through
 * a 0.12 lens read as flat, so they'd stay flat forever). Divide the
 * currently-applied exaggeration back out to get true DEM relief.
 */
export function trueReliefFromMeasured(measuredReliefM: number, appliedExaggeration: number): number {
  return appliedExaggeration > 0.01 ? measuredReliefM / appliedExaggeration : measuredReliefM;
}
