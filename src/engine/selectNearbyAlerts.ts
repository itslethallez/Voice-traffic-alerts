import type { WazeAlert } from '../api/waze/types';
import { bearingBetween, bearingDifference } from '../geo/bearing';
import { haversineDistance } from '../geo/distance';
import type { GeoPoint } from '../geo/types';

export interface NearbyAlert {
  alert: WazeAlert;
  distanceMeters: number;
}

const DEFAULT_COUNT = 3;

/** Deliberately wider than announceWindow.ts's strict 45-degree
 * announce-eligibility bearing (ANNOUNCE_MAX_BEARING_DIFF_DEG) - this
 * feeds a glanceable "what's nearby" list on the Drive screen, not the
 * live announcement filter, so a generous front half-plane is more useful
 * than a narrow cone. */
const NEARBY_MAX_BEARING_DIFF_DEG = 90;

/**
 * The `count` closest alerts roughly ahead of the driver (within
 * NEARBY_MAX_BEARING_DIFF_DEG of headingDeg), sorted nearest-first - the
 * Drive screen's alert ledger (Step 12 #25). No distance ceiling,
 * freshness check, or category filter: unlike selectAnnounceableAlerts,
 * this only decides what to show in a glance list, not what to speak.
 */
export function selectNearbyAlerts(
  alerts: WazeAlert[],
  driverPosition: GeoPoint,
  driverHeadingDeg: number,
  count: number = DEFAULT_COUNT
): NearbyAlert[] {
  const candidates: NearbyAlert[] = [];

  for (const alert of alerts) {
    const alertPosition = { latitude: alert.latitude, longitude: alert.longitude };
    const bearingDeg = bearingBetween(driverPosition, alertPosition);
    const bearingDiffDeg = bearingDifference(driverHeadingDeg, bearingDeg);
    if (bearingDiffDeg > NEARBY_MAX_BEARING_DIFF_DEG) continue;

    candidates.push({ alert, distanceMeters: haversineDistance(driverPosition, alertPosition) });
  }

  candidates.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return candidates.slice(0, count);
}
