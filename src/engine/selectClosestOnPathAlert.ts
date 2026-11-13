import type { WazeAlert } from '../api/waze/types';
import { bearingBetween, bearingDifference } from '../geo/bearing';
import { haversineDistance } from '../geo/distance';
import { isDistanceAnnounceable } from '../geo/announceWindow';
import type { GeoPoint } from '../geo/types';

export interface ClosestAlert {
  alert: WazeAlert;
  distanceMeters: number;
  bearingDeg: number;
  /** 0-180, how far off the driver's current heading the alert is - see
   * geo/bearing.ts's signedBearingOffset for the signed (left/right)
   * version RadarMap.tsx's focus panel uses for its "12° LEFT" wording. */
  bearingDiffDeg: number;
}

/**
 * The single nearest alert within the announce distance window (Focus
 * panel, `Voice Traffic Alerts - Current UI.dc.html` turn 6) - shared by
 * RadarMap.tsx (which alert gets the bottom focus panel, and whether it's
 * the full on-path treatment or the one-line off-path one) and
 * DriveScreen.tsx (which alert the "ALSO AHEAD" ledger excludes), so both
 * agree on exactly the same one rather than each independently picking
 * their own notion of "closest" and drifting apart.
 *
 * Distance-windowed the same way selectAnnounceableAlerts gates TTS
 * eligibility (isDistanceAnnounceable), but deliberately NOT bearing-gated
 * here - unlike the announcer, which simply skips an off-path alert,
 * RadarMap.tsx needs to know about an off-path closest alert too (to render
 * the "68° OFF HEADING" quiet line instead of nothing), so bearingDiffDeg is
 * returned for the caller to branch on rather than filtered here.
 */
export function selectClosestOnPathAlert(
  alerts: WazeAlert[],
  driverPosition: GeoPoint,
  driverHeadingDeg: number,
  maxDistanceMeters: number
): ClosestAlert | null {
  let closest: ClosestAlert | null = null;

  for (const alert of alerts) {
    const alertPosition = { latitude: alert.latitude, longitude: alert.longitude };
    const distanceMeters = haversineDistance(driverPosition, alertPosition);
    if (!isDistanceAnnounceable(distanceMeters, maxDistanceMeters)) continue;
    if (closest && distanceMeters >= closest.distanceMeters) continue;

    const bearingDeg = bearingBetween(driverPosition, alertPosition);
    const bearingDiffDeg = bearingDifference(driverHeadingDeg, bearingDeg);
    closest = { alert, distanceMeters, bearingDeg, bearingDiffDeg };
  }

  return closest;
}
