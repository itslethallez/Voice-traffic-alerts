import type { VercelRequest, VercelResponse } from '../../lib/vercel-types';
import { getRedis } from '../../lib/redis';
import { captureException, withSentry } from '../../lib/sentry';
import {
  findShareableRoute,
  haversineMeters,
  shareKey,
  trimDirections,
  type StoredDirections,
} from '../../lib/routeShare';

/**
 * GET /api/road/forward-route - road matching's one Mapbox Directions
 * request, shared across every driver (see lib/routeShare.ts).
 *
 * Params: fromLat, fromLng, heading (0-360), toLat, toLng.
 * Returns { directions, cache: 'hit' | 'miss' } - `directions` is a
 * trimmed Mapbox Directions body, so the app parses a hit and a miss the
 * same way it parses a direct call.
 *
 * Not an open Directions proxy: origin and destination must be within
 * MAX_SPAN_METERS (the largest warn radius at Far is 7.5km) and in
 * Australia. Redis is a cache only - if it's down every request goes to
 * Mapbox, which costs money but never fails the driver.
 *
 * Log tag: [road].
 */

const DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving/';
/** Road geometry doesn't change; alerts expire long before this. */
const CACHE_TTL_SECONDS = 6 * 60 * 60;
/** Approaches kept per alert (two directions, plus side roads). */
const MAX_ROUTES_PER_ALERT = 6;
const MAX_SPAN_METERS = 10_000;
const MAPBOX_TIMEOUT_MS = 3_500;
/** Australia, loosely (incl. Tasmania and the external territories' mainland ports). */
const AU_BOUNDS = { minLat: -44, maxLat: -9, minLng: 112, maxLng: 154 };

function num(value: unknown): number | null {
  const n = Number(value);
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(n) ? n : null;
}

function inAustralia(lat: number, lng: number): boolean {
  return lat >= AU_BOUNDS.minLat && lat <= AU_BOUNDS.maxLat && lng >= AU_BOUNDS.minLng && lng <= AU_BOUNDS.maxLng;
}

async function fetchDirections(from: { lat: number; lng: number }, heading: number, to: { lat: number; lng: number }): Promise<StoredDirections> {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error('MAPBOX_ACCESS_TOKEN is not set');
  const params = new URLSearchParams({
    alternatives: 'false',
    geometries: 'geojson',
    overview: 'full',
    steps: 'true',
    bearings: `${Math.round(heading)},45;`,
    access_token: token,
  });
  const url = `${DIRECTIONS_URL}${from.lng},${from.lat};${to.lng},${to.lat}?${params.toString()}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(MAPBOX_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Mapbox Directions failed with status ${response.status}`);
  const body = (await response.json()) as StoredDirections;
  if (body.code !== 'Ok' || !body.routes?.[0]) throw new Error(`Mapbox Directions returned ${body.code}`);
  return trimDirections(body);
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const fromLat = num(req.query.fromLat);
  const fromLng = num(req.query.fromLng);
  const toLat = num(req.query.toLat);
  const toLng = num(req.query.toLng);
  const heading = num(req.query.heading);
  if (fromLat === null || fromLng === null || toLat === null || toLng === null || heading === null) {
    res.status(400).json({ error: 'fromLat, fromLng, heading, toLat and toLng must be numbers' });
    return;
  }
  if (heading < 0 || heading > 360) {
    res.status(400).json({ error: 'heading must be in degrees, 0-360' });
    return;
  }
  if (!inAustralia(fromLat, fromLng) || !inAustralia(toLat, toLng)) {
    res.status(400).json({ error: 'origin and destination must be in Australia' });
    return;
  }
  const from = { lat: fromLat, lng: fromLng };
  const to = { lat: toLat, lng: toLng };
  if (haversineMeters(from, to) > MAX_SPAN_METERS) {
    res.status(400).json({ error: `origin and destination must be within ${MAX_SPAN_METERS}m` });
    return;
  }

  const key = shareKey(to);
  let stored: StoredDirections[] = [];
  try {
    stored = (await getRedis().get<StoredDirections[]>(key)) ?? [];
    const shared = findShareableRoute(stored, from, heading % 360);
    if (shared) {
      console.log(`[road] shared hit ${key} (${stored.length} cached)`);
      res.status(200).json({ directions: shared, cache: 'hit' });
      return;
    }
  } catch (error) {
    console.warn('[road] redis read unavailable, asking Mapbox directly', error);
  }

  try {
    const directions = await fetchDirections(from, heading % 360, to);
    console.log(`[road] shared miss ${key} - Mapbox call`);
    try {
      await getRedis().set(key, [directions, ...stored].slice(0, MAX_ROUTES_PER_ALERT), { ex: CACHE_TTL_SECONDS });
    } catch (error) {
      console.warn('[road] redis write failed, route not shared', error);
    }
    res.status(200).json({ directions, cache: 'miss' });
  } catch (error) {
    captureException(error);
    console.error('[road] Mapbox Directions failed', error);
    res.status(502).json({ error: 'Directions unavailable' });
  }
}

export default withSentry(handler);
