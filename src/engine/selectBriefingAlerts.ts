import type { WazeAlert, WazeAlertType } from '../api/waze/types';
import { isFreshEnoughToAnnounce } from '../geo/announceWindow';
import { haversineDistance } from '../geo/distance';
import type { GeoPoint } from '../geo/types';
import { MAX_BRIEFING_ALERTS } from './constants';
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
 * driving). Deliberately no bearing/heading check (no direction of
 * travel yet), no announce-window distance/bearing logic, and no
 * severity reordering - sorted nearest-first instead, with alert_id as a
 * stable tiebreaker for alerts at an identical distance. Capped at
 * MAX_BRIEFING_ALERTS.
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

  candidates.sort((a, b) => {
    if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
    return a.alert.alert_id.localeCompare(b.alert.alert_id);
  });

  return candidates.slice(0, MAX_BRIEFING_ALERTS);
}
