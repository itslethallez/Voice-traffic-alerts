import type { WazeAlert } from '../api/waze/types';
import { destinationPoint } from '../geo/destination';
import type { GeoPoint } from '../geo/types';

/**
 * Test-build-only briefing fixture: three synthetic alerts around wherever
 * the trip starts, so a drive test can prove the briefing (suburb resolved
 * before prefetch, gaps that hold with the screen off) on demand - the live
 * feed is often too thin to brief anything. Only compiled in when the build
 * sets EXPO_PUBLIC_BRIEFING_FIXTURE=1 (config/featureFlags.ts); never in a
 * release build. Streets are left empty on purpose, so every sentence leans
 * on the reverse-geocoded suburb ("Crash reported in Netley, ...").
 *
 * Log tag: [briefing] (tripRuntime.ts logs "fixture injected").
 */
const ITEMS: ReadonlyArray<{ type: WazeAlert['type']; distanceMeters: number; bearingDeg: number; ageMinutes: number }> = [
  { type: 'ACCIDENT', distanceMeters: 1_200, bearingDeg: 0, ageMinutes: 4 },
  { type: 'HAZARD', distanceMeters: 1_500, bearingDeg: 90, ageMinutes: 7 },
  { type: 'POLICE', distanceMeters: 2_500, bearingDeg: 180, ageMinutes: 2 },
];

export function briefingFixtureAlerts(origin: GeoPoint, nowMs: number): WazeAlert[] {
  return ITEMS.map((item, i) => {
    const at = destinationPoint(origin, item.distanceMeters, item.bearingDeg);
    return {
      alert_id: `fixture-briefing-${i + 1}`,
      type: item.type,
      subtype: null,
      reported_by: null,
      description: null,
      image: null,
      publish_datetime_utc: new Date(nowMs - item.ageMinutes * 60_000).toISOString(),
      country: 'AU',
      city: '',
      street: null,
      latitude: at.latitude,
      longitude: at.longitude,
      num_thumbs_up: 0,
      alert_reliability: 0,
      alert_confidence: 0,
      near_by: null,
      comments: [],
      num_comments: 0,
    };
  });
}
