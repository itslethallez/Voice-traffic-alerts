/**
 * Road matching's forward route from Shotgun's own Valhalla server
 * (DigitalOcean SYD1, infra/valhalla/ - approved 21 Nov 2026 as the one
 * always-on service, see CLAUDE.md). api/road/forward-route.ts asks this
 * first and falls back to Mapbox Directions.
 *
 * The app parses a Mapbox Directions body (src/api/mapbox/forwardRoute.ts),
 * so a Valhalla answer is converted into that shape here - the app can't
 * tell which router answered, except by the `router` field the endpoint
 * adds for its [road] log line.
 *
 * Two Valhalla calls per route, both on our own server (no per-call cost):
 * - /route, with the driver's heading (heading_tolerance 45, the same as
 *   Mapbox's `bearings=<h>,45`), for the geometry and turn types;
 * - /trace_attributes edge_walk over that same shape, for each road
 *   piece's names. /route's maneuvers keep a road under its common route
 *   number where its name changes ("A6" for all of Burbridge Road / Sir
 *   Donald Bradman Drive), which road matching can't match a report's
 *   street against.
 *
 * Measured against Mapbox on the audit cases at real Adelaide locations
 * (21 Nov 2026 trial): same verdict on 13/13, along-road distance within
 * 2m. Fixtures: lib/__tests__/fixtures/valhalla/ and
 * src/road/__tests__/valhallaCases.test.ts.
 */

import type { LatLng, StoredDirections } from './routeShare';
import { haversineMeters } from './routeShare';

export interface ValhallaManeuver {
  type: number;
  begin_shape_index: number;
}
export interface ValhallaRouteBody {
  trip?: { legs: Array<{ shape: string; maneuvers: ValhallaManeuver[] }> };
  error?: string;
  error_code?: number;
}
export interface ValhallaEdge {
  names?: string[];
  begin_shape_index: number;
  end_shape_index: number;
}
export interface ValhallaTraceBody {
  edges?: ValhallaEdge[];
  error?: string;
}

/** Header the server's Caddy checks (infra/valhalla/Caddyfile). */
export const VALHALLA_SECRET_HEADER = 'x-shotgun-valhalla-secret';

export function decodePolyline6(encoded: string): LatLng[] {
  const out: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (let which = 0; which < 2; which++) {
      let byte: number;
      let shift = 0;
      let result = 0;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    out.push({ lat: lat / 1e6, lng: lng / 1e6 });
  }
  return out;
}

/** Valhalla maneuver type (valhalla/proto/directions.proto) -> Mapbox
 * maneuver type + modifier, as road/classifyRoute.ts reads them. */
export function mapManeuver(type: number): { type: string; modifier?: string } {
  switch (type) {
    case 1:
    case 2:
    case 3:
      return { type: 'depart' };
    case 4:
    case 5:
    case 6:
      return { type: 'arrive' };
    case 7:
      return { type: 'new name', modifier: 'straight' };
    case 8:
      return { type: 'continue', modifier: 'straight' };
    case 9:
      return { type: 'turn', modifier: 'slight right' };
    case 10:
      return { type: 'turn', modifier: 'right' };
    case 11:
      return { type: 'turn', modifier: 'sharp right' };
    case 12:
    case 13:
      return { type: 'continue', modifier: 'uturn' };
    case 14:
      return { type: 'turn', modifier: 'sharp left' };
    case 15:
      return { type: 'turn', modifier: 'left' };
    case 16:
      return { type: 'turn', modifier: 'slight left' };
    case 17:
      return { type: 'on ramp', modifier: 'straight' };
    case 18:
      return { type: 'on ramp', modifier: 'right' };
    case 19:
      return { type: 'on ramp', modifier: 'left' };
    case 20:
      return { type: 'off ramp', modifier: 'right' };
    case 21:
      return { type: 'off ramp', modifier: 'left' };
    case 22:
      return { type: 'fork', modifier: 'straight' };
    case 23:
      return { type: 'fork', modifier: 'slight right' };
    case 24:
      return { type: 'fork', modifier: 'slight left' };
    case 25:
    case 37:
    case 38:
      return { type: 'merge' };
    case 26:
      return { type: 'roundabout' };
    case 27:
      return { type: 'exit roundabout' };
    default:
      return { type: 'notification' };
  }
}

/** A road's name ("Sir Donald Bradman Drive"), not its route number ("A6"). */
export function preferredName(names: readonly string[] | undefined): string {
  return (names ?? []).find((n) => !/^[A-Z]{1,2}\d{1,3}$/.test(n.trim())) ?? '';
}

/** A U-turn through a median crossing starts on the crossing's own short
 * edge, which OSM often names after the cross street ("Winifred Street").
 * Mapbox names a U-turn step after the road you come back along; so does
 * this, for a name change within this distance of the U-turn. */
const UTURN_CROSSING_MAX_METERS = 50;

/**
 * Converts Valhalla's /route + /trace_attributes answers into the Mapbox
 * Directions body the app parses. Steps split at every maneuver and at
 * every road-name change (as Mapbox's "new name" steps do); distances come
 * from the shape itself, so step offsets line up with the polyline the app
 * projects onto.
 */
export function valhallaToDirections(route: ValhallaRouteBody, trace: ValhallaTraceBody, from: LatLng, to: LatLng): StoredDirections {
  const leg = route.trip?.legs[0];
  if (!leg) throw new Error(`Valhalla route: ${route.error ?? 'no trip'}`);
  const edges = trace.edges ?? [];
  if (edges.length === 0) throw new Error(`Valhalla trace_attributes: ${trace.error ?? 'no edges'}`);
  const shape = decodePolyline6(leg.shape);
  if (shape.length < 2) throw new Error('Valhalla route: empty shape');

  const cumulative = [0];
  for (let i = 1; i < shape.length; i++) cumulative.push(cumulative[i - 1] + haversineMeters(shape[i - 1], shape[i]));
  const total = cumulative[cumulative.length - 1];
  const at = (i: number) => cumulative[Math.min(Math.max(i, 0), cumulative.length - 1)];

  const maneuverAt = new Map<number, ValhallaManeuver>();
  for (const m of leg.maneuvers.slice(1)) {
    if (mapManeuver(m.type).type !== 'arrive') maneuverAt.set(m.begin_shape_index, m);
  }

  type Step = StoredDirections['routes'][number]['legs'][number]['steps'][number];
  const steps: Step[] = [];
  let startIndex = 0;
  let current: { name: string; maneuver: { type: string; modifier?: string } } = {
    name: preferredName(edges[0].names),
    maneuver: { type: 'depart' },
  };
  const close = (endIndex: number) => steps.push({ name: current.name, distance: at(endIndex) - at(startIndex), maneuver: current.maneuver });

  for (const edge of edges.slice(1)) {
    const name = preferredName(edge.names);
    const maneuver = maneuverAt.get(edge.begin_shape_index);
    if (!maneuver && current.maneuver.modifier === 'uturn' && at(edge.begin_shape_index) - at(startIndex) < UTURN_CROSSING_MAX_METERS) {
      current.name = name;
      continue;
    }
    if (maneuver || name !== current.name) {
      close(edge.begin_shape_index);
      startIndex = edge.begin_shape_index;
      current = { name, maneuver: maneuver ? mapManeuver(maneuver.type) : { type: 'new name', modifier: 'straight' } };
    }
  }
  close(shape.length - 1);
  steps.push({ name: current.name, distance: 0, maneuver: { type: 'arrive' } });

  return {
    code: 'Ok',
    routes: [{ distance: total, geometry: { coordinates: shape.map((p) => [p.lng, p.lat]) }, legs: [{ steps }] }],
    waypoints: [{ distance: haversineMeters(from, shape[0]) }, { distance: haversineMeters(to, shape[shape.length - 1]) }],
    router: 'valhalla',
  };
}

export interface ValhallaOptions {
  baseUrl: string;
  secret: string;
  signal: AbortSignal;
}

async function post<T>(opts: ValhallaOptions, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${opts.baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [VALHALLA_SECRET_HEADER]: opts.secret },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(`Valhalla ${path} failed with status ${response.status}${json.error ? `: ${json.error}` : ''}`);
  return json;
}

/** The forward route from `from` (heading `headingDeg`) to `to`, from Valhalla. */
export async function fetchValhallaDirections(from: LatLng, headingDeg: number, to: LatLng, opts: ValhallaOptions): Promise<StoredDirections> {
  const route = await post<ValhallaRouteBody>(opts, '/route', {
    locations: [
      { lat: from.lat, lon: from.lng, heading: Math.round(headingDeg) % 360, heading_tolerance: 45 },
      { lat: to.lat, lon: to.lng },
    ],
    costing: 'auto',
    units: 'kilometers',
    directions_type: 'maneuvers',
  });
  const leg = route.trip?.legs[0];
  if (!leg) throw new Error(`Valhalla route: ${route.error ?? 'no trip'}`);
  const trace = await post<ValhallaTraceBody>(opts, '/trace_attributes', {
    encoded_polyline: leg.shape,
    costing: 'auto',
    shape_match: 'edge_walk',
    filters: { attributes: ['edge.names', 'edge.begin_shape_index', 'edge.end_shape_index'], action: 'include' },
  });
  return valhallaToDirections(route, trace, from, to);
}
