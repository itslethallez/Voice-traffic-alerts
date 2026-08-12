import type { WazeAlert } from '../api/waze/types';
import { bearingBetween, bearingDifference } from '../geo/bearing';
import { haversineDistance } from '../geo/distance';
import {
  isBearingAnnounceable,
  isDistanceAnnounceable,
  isFreshEnoughToAnnounce,
} from '../geo/announceWindow';
import { sortBySeverity } from './severity';
import type { AnnounceableAlert, DriverState } from './types';

/**
 * The four rules from the spec, applied together: distance 300m-2000m,
 * bearing within 45 degrees of heading, not already announced this trip,
 * report under 30 minutes old. Result is sorted by severity (see
 * severity.ts), highest priority first.
 */
export function selectAnnounceableAlerts(
  alerts: WazeAlert[],
  driver: DriverState,
  alreadyAnnouncedIds: ReadonlySet<string>,
  nowMs: number
): AnnounceableAlert[] {
  const candidates: AnnounceableAlert[] = [];

  for (const alert of alerts) {
    if (alreadyAnnouncedIds.has(alert.alert_id)) continue;

    const alertPosition = { latitude: alert.latitude, longitude: alert.longitude };
    const distanceMeters = haversineDistance(driver.position, alertPosition);
    if (!isDistanceAnnounceable(distanceMeters)) continue;

    const bearingDeg = bearingBetween(driver.position, alertPosition);
    const bearingDiffDeg = bearingDifference(driver.headingDeg, bearingDeg);
    if (!isBearingAnnounceable(bearingDiffDeg)) continue;

    const ageMinutes = (nowMs - Date.parse(alert.publish_datetime_utc)) / 60_000;
    if (!isFreshEnoughToAnnounce(ageMinutes)) continue;

    candidates.push({ alert, distanceMeters, bearingDeg, bearingDiffDeg, ageMinutes });
  }

  return sortBySeverity(candidates);
}
