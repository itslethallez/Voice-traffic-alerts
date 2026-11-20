import { haversineDistance } from '../geo/distance';
import type { GeoPoint } from '../geo/types';

/** Cumulative distance (m) at each vertex - [0, d01, d01+d12, ...]. */
export function cumulativeDistances(polyline: readonly GeoPoint[]): number[] {
  const cum = [0];
  for (let i = 1; i < polyline.length; i++) {
    cum.push(cum[i - 1] + haversineDistance(polyline[i - 1], polyline[i]));
  }
  return cum;
}

export interface PolylineProjection {
  /** Perpendicular distance from the point to the line, metres. */
  offsetMeters: number;
  /** Distance along the line from its start to the projected point. */
  progressMeters: number;
}

/**
 * Projects a point onto a polyline using a local equirectangular frame per
 * segment - accurate to well under a metre at the few-km scale a forward
 * route covers, and cheap enough to run per driver update.
 */
export function projectOntoPolyline(
  point: GeoPoint,
  polyline: readonly GeoPoint[],
  cumulative: readonly number[]
): PolylineProjection {
  if (polyline.length === 0) return { offsetMeters: Infinity, progressMeters: 0 };
  if (polyline.length === 1) return { offsetMeters: haversineDistance(point, polyline[0]), progressMeters: 0 };

  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((point.latitude * Math.PI) / 180);

  let best: PolylineProjection = { offsetMeters: Infinity, progressMeters: 0 };
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const ax = (a.longitude - point.longitude) * metersPerDegLon;
    const ay = (a.latitude - point.latitude) * metersPerDegLat;
    const bx = (b.longitude - point.longitude) * metersPerDegLon;
    const by = (b.latitude - point.latitude) * metersPerDegLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const offset = Math.sqrt(px * px + py * py);
    if (offset < best.offsetMeters) {
      best = { offsetMeters: offset, progressMeters: cumulative[i] + t * (cumulative[i + 1] - cumulative[i]) };
    }
  }
  return best;
}
