import type { WazeAlert, WazeAlertType } from '../api/waze/types';
import { bearingBetween, bearingDifference } from '../geo/bearing';
import { haversineDistance } from '../geo/distance';
import {
  ANNOUNCE_MAX_DISTANCE_M,
  ANNOUNCE_MIN_DISTANCE_M,
  isBearingAnnounceable,
  isDistanceAnnounceable,
  isFreshEnoughToAnnounce,
  isMeaningfullyCloser,
} from '../geo/announceWindow';
import { distanceToPolyline } from '../geo/routePolyline';
import type { GeoPoint } from '../geo/types';
import { dedupeNearbyAlerts } from './dedupeNearbyAlerts';
import { sortBySeverity } from './severity';
import type { AnnounceableAlert, DriverState } from './types';

export interface AnnounceSettings {
  /** undefined means every category is enabled - Step 7's Settings screen passes its own. */
  enabledTypes?: ReadonlySet<WazeAlertType>;
  maxDistanceMeters: number;
  /** Nav mode only: when set, an alert is announceable by proximity to the
   * remaining route (distanceToPolyline <= corridorMeters) instead of the
   * usual straight-line-distance + bearing-of-travel window - a hazard
   * several km up the road you're actually driving is worth an early
   * mention, while one just as close but off your route isn't. The
   * ANNOUNCE_MIN_DISTANCE_M floor and freshness/dedupe rules still apply on
   * top of this. undefined (cruising mode, or navigation with no route yet)
   * leaves the existing radius+bearing behaviour untouched. */
  routeCorridor?: { polyline: readonly GeoPoint[]; corridorMeters: number };
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
 * reminder.
 *
 * When `settings.routeCorridor` is set (nav mode with an active route), the
 * distance-upper-bound + bearing pair above is replaced by proximity to the
 * route itself - see the option's own doc comment.
 *
 * Candidates are then deduped by real-world proximity (dedupeNearbyAlerts) -
 * two different Waze users reporting the same police car moments apart
 * produce two different alert_ids, which the announcedDistances check
 * above can't catch (it only recognises the *same* id being re-seen). Only
 * the more-corroborated of a cluster survives; if that one later drops out
 * of the feed while the other persists, the other is treated as a fresh,
 * never-announced alert - an acceptable edge case, not a bug, since the
 * two were never actually tracked as the same alert internally.
 *
 * Result is sorted by severity (see severity.ts), highest priority first.
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

    if (settings.routeCorridor) {
      if (distanceMeters < ANNOUNCE_MIN_DISTANCE_M) continue;
      const corridorDistanceM = distanceToPolyline(alertPosition, settings.routeCorridor.polyline);
      if (corridorDistanceM > settings.routeCorridor.corridorMeters) continue;
    } else if (!isDistanceAnnounceable(distanceMeters, settings.maxDistanceMeters)) {
      continue;
    }

    const bearingDeg = bearingBetween(driver.position, alertPosition);
    const bearingDiffDeg = bearingDifference(driver.headingDeg, bearingDeg);
    if (!settings.routeCorridor && !isBearingAnnounceable(bearingDiffDeg)) continue;

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

  return sortBySeverity(dedupeNearbyAlerts(candidates, driver.headingDeg));
}
