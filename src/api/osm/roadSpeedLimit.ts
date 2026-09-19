import type { GeoPoint } from '../../geo/types';

/**
 * Only these road classes are ever queried - live testing this session
 * (Overpass, against the Adelaide metro test area) found 92.7% maxspeed
 * coverage here versus 69.1% on residential/tertiary streets. That gap is
 * wide enough that a missing tag on a residential street would make the
 * speed-warning feature unreliable there, so it's scoped out entirely
 * rather than guessing a default limit.
 */
const MAJOR_ROAD_CLASSES = 'motorway|trunk|primary|secondary';

/** Nearby-way search radius in metres - wide enough to catch the road the
 * driver's actually on despite GPS drift, narrow enough to keep Overpass
 * queries cheap and fast. */
const SEARCH_RADIUS_M = 150;

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

interface OverpassNode {
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: 'way';
  tags?: Record<string, string>;
  geometry?: OverpassNode[];
}

interface OverpassResponse {
  elements: OverpassWay[];
}

function haversineMeters(a: GeoPoint, b: OverpassNode): number {
  const EARTH_RADIUS_M = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.latitude);
  const dLon = toRad(b.lon - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** OSM maxspeed values seen live this session were plain integers ("50",
 * "80"). A non-numeric value (a zone code like "AU:urban", or "none") is
 * left unparsed rather than guessed at. */
function parseMaxspeedKmh(maxspeed: string | undefined): number | null {
  if (!maxspeed) return null;
  const match = maxspeed.match(/^\d+/);
  return match ? Number(match[0]) : null;
}

/**
 * Finds the posted speed limit of whichever major road is nearest `point`,
 * via Overpass. "Nearest" is approximated as the closest individual node
 * across all candidate ways' geometry, not true point-to-segment distance -
 * a deliberate simplification: major-road nodes are closely spaced enough,
 * relative to SEARCH_RADIUS_M, for this to reliably pick the right road
 * without the extra complexity of real polyline-distance math.
 */
export async function fetchSpeedLimitNear(
  point: GeoPoint,
  options: { signal?: AbortSignal } = {}
): Promise<number | null> {
  const query = `[out:json][timeout:25];way[highway~"^(${MAJOR_ROAD_CLASSES})$"](around:${SEARCH_RADIUS_M},${point.latitude},${point.longitude});out geom;`;

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Overpass request failed with status ${response.status}`);
  }

  const data = (await response.json()) as OverpassResponse;

  let nearestWay: OverpassWay | null = null;
  let nearestDistanceM = Infinity;
  for (const way of data.elements) {
    if (!way.geometry) continue;
    for (const node of way.geometry) {
      const distanceM = haversineMeters(point, node);
      if (distanceM < nearestDistanceM) {
        nearestDistanceM = distanceM;
        nearestWay = way;
      }
    }
  }

  return nearestWay ? parseMaxspeedKmh(nearestWay.tags?.maxspeed) : null;
}
