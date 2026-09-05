import type { WazeAlert, WazeAlertType } from '../api/waze/types';
import { isFreshEnoughToAnnounce } from '../geo/announceWindow';
import { haversineDistance } from '../geo/distance';
import type { GeoPoint } from '../geo/types';
import { MAX_BRIEFING_ALERTS } from './constants';
import { dedupeNearbyAlerts } from './dedupeNearbyAlerts';
import type { AnnounceableAlert } from './types';

export interface BriefingSelectSettings {
  /** undefined means every category is enabled. */
  enabledTypes?: ReadonlySet<WazeAlertType>;
  radiusMeters: number;
}

/**
 * Cold-start briefing selection: distance from `position` (no minimum -
 * unlike live driving's 300m floor, something right next to a stationary
 * driver is exactly what a briefing is for) within the configured
 * briefing radius, the enabled-category filter, and the existing
 * 30-minute freshness cutoff (isFreshEnoughToAnnounce, shared with live
 * driving). Deliberately no announce-window distance/bearing logic, and
 * no severity reordering - sorted nearest-first instead, with alert_id as
 * a stable tiebreaker for alerts at an identical distance. Capped at
 * MAX_BRIEFING_ALERTS.
 *
 * Also runs the same cluster dedupe live driving uses (dedupeNearbyAlerts)
 * before sorting/capping - a stationary cold start is exactly the densest
 * moment for duplicate same-type reports around the driver, so skipping
 * this here would leave the briefing speaking both. Passed heading 0
 * (matching every candidate's own placeholder driverHeadingDeg below,
 * since there's no real direction of travel yet) - dedupeNearbyAlerts'
 * carriageway/bearing check degrades to an arbitrary axis in that case,
 * but its same-spot bypass (alerts within ~30m) still catches the
 * overwhelmingly common case: two reporters describing one incident from
 * essentially the same location.
 */
export function selectBriefingAlerts(
  alerts: WazeAlert[],
  position: GeoPoint,
  nowMs: number,
  settings: BriefingSelectSettings
): AnnounceableAlert[] {
  const candidates: AnnounceableAlert[] = [];

  for (const alert of alerts) {
    if (settings.enabledTypes && !settings.enabledTypes.has(alert.type)) continue;

    const alertPosition = { latitude: alert.latitude, longitude: alert.longitude };
    const distanceMeters = haversineDistance(position, alertPosition);
    if (distanceMeters > settings.radiusMeters) continue;

    const ageMinutes = (nowMs - Date.parse(alert.publish_datetime_utc)) / 60_000;
    if (!isFreshEnoughToAnnounce(ageMinutes)) continue;

    candidates.push({
      alert,
      distanceMeters,
      bearingDeg: 0,
      bearingDiffDeg: 0,
      ageMinutes,
      driverHeadingDeg: 0,
    });
  }

  const deduped = dedupeNearbyAlerts(candidates, 0);

  deduped.sort((a, b) => {
    if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
    return a.alert.alert_id.localeCompare(b.alert.alert_id);
  });

  return deduped.slice(0, MAX_BRIEFING_ALERTS);
}
