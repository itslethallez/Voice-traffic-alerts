import type { WazeAlert, WazeAlertType } from '../api/waze/types';
import { bearingBetween, bearingDifference } from '../geo/bearing';
import { haversineDistance } from '../geo/distance';
import {
  ANNOUNCE_MAX_DISTANCE_M,
  isBearingAnnounceable,
  isDistanceAnnounceable,
  isFreshEnoughToAnnounce,
  isMeaningfullyCloser,
} from '../geo/announceWindow';
import { sortBySeverity } from './severity';
import type { AnnounceableAlert, DriverState } from './types';

export interface AnnounceSettings {
  /** undefined means every category is enabled - Step 7's Settings screen passes its own. */
  enabledTypes?: ReadonlySet<WazeAlertType>;
  maxDistanceMeters: number;
}

export const defaultAnnounceSettings: AnnounceSettings = {
  enabledTypes: undefined,
  maxDistanceMeters: ANNOUNCE_MAX_DISTANCE_M,
};

/**
 * The four rules from the spec, applied together: distance 300m-2000m
 * (2000m is the default upper bound; Step 7's distance slider can raise
 * or lower it via `settings`), bearing within 45 degrees of heading,
 * report under 30 minutes old - plus an optional category filter from
 * Settings. An alert already announced this trip is skipped unless the
 * driver has since gotten meaningfully closer to it (see
 * isMeaningfullyCloser), in which case it qualifies again as a proximity
 * reminder. Result is sorted by severity (see severity.ts), highest
 * priority first.
 */
export function selectAnnounceableAlerts(
  alerts: WazeAlert[],
  driver: DriverState,
  announcedDistances: ReadonlyMap<string, number>,
  nowMs: number,
  settings: AnnounceSettings = defaultAnnounceSettings
): AnnounceableAlert[] {
  const candidates: AnnounceableAlert[] = [];

  for (const alert of alerts) {
    if (settings.enabledTypes && !settings.enabledTypes.has(alert.type)) continue;

    const alertPosition = { latitude: alert.latitude, longitude: alert.longitude };
    const distanceMeters = haversineDistance(driver.position, alertPosition);

    const lastAnnouncedDistanceMeters = announcedDistances.get(alert.alert_id);
    if (
      lastAnnouncedDistanceMeters !== undefined &&
      !isMeaningfullyCloser(distanceMeters, lastAnnouncedDistanceMeters)
    ) {
      continue;
    }

    if (!isDistanceAnnounceable(distanceMeters, settings.maxDistanceMeters)) continue;

    const bearingDeg = bearingBetween(driver.position, alertPosition);
    const bearingDiffDeg = bearingDifference(driver.headingDeg, bearingDeg);
    if (!isBearingAnnounceable(bearingDiffDeg)) continue;

    const ageMinutes = (nowMs - Date.parse(alert.publish_datetime_utc)) / 60_000;
    if (!isFreshEnoughToAnnounce(ageMinutes)) continue;

    candidates.push({
      alert,
      distanceMeters,
      bearingDeg,
      bearingDiffDeg,
      ageMinutes,
      driverHeadingDeg: driver.headingDeg,
    });
  }

  return sortBySeverity(candidates);
}
