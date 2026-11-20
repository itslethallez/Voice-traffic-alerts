import type { WazeAlert } from '../api/waze/types';
import { REMINDER_MIN_CLOSER_METERS } from '../geo/announceWindow';
import { selectAnnounceableAlerts, type AnnounceSettings } from './selectAlerts';
import type { ApproachingAlert, DriverState } from './types';

/**
 * Alerts that aren't announceable yet but will be once the driver covers
 * `lookaheadMeters` more road - each with the distance at which it becomes
 * eligible. Feeds speech/predictAnnouncement.ts, so the entry announcement's
 * Google TTS audio can be fetched before the alert reaches the warn radius.
 *
 * Reuses selectAnnounceableAlerts' own rules rather than restating them,
 * with the two distance thresholds pushed out by `lookaheadMeters`: the
 * warn radius (maxDistanceMeters) and, for an alert already announced, the
 * REMINDER_MIN_CLOSER_METERS reminder threshold. Heading cone, freshness,
 * category filter and dedupe all apply exactly as they will at entry.
 * Anything already eligible now is excluded - that's the queue's job.
 *
 * Pure prediction input: nothing here is announced or queued.
 */
export function selectApproachingAlerts(
  alerts: WazeAlert[],
  driver: DriverState,
  announcedDistances: ReadonlyMap<string, number>,
  nowMs: number,
  settings: AnnounceSettings,
  lookaheadMeters: number
): ApproachingAlert[] {
  if (!(lookaheadMeters > 0)) return [];

  const eligibleNow = new Set(
    selectAnnounceableAlerts(alerts, driver, announcedDistances, nowMs, settings).map((c) => c.alert.alert_id)
  );

  const shiftedAnnounced = new Map<string, number>();
  for (const [id, distance] of announcedDistances) shiftedAnnounced.set(id, distance + lookaheadMeters);

  const extended = selectAnnounceableAlerts(alerts, driver, shiftedAnnounced, nowMs, {
    ...settings,
    maxDistanceMeters: settings.maxDistanceMeters + lookaheadMeters,
  });

  const approaching: ApproachingAlert[] = [];
  for (const candidate of extended) {
    if (eligibleNow.has(candidate.alert.alert_id)) continue;
    const lastAnnounced = announcedDistances.get(candidate.alert.alert_id);
    // In nav mode (routeCorridor) the radius doesn't gate eligibility, so
    // only the reminder threshold is an entry point there.
    const radiusEntry = settings.routeCorridor ? Infinity : settings.maxDistanceMeters;
    const entryDistanceMeters =
      lastAnnounced === undefined ? radiusEntry : Math.min(radiusEntry, lastAnnounced - REMINDER_MIN_CLOSER_METERS);
    if (!Number.isFinite(entryDistanceMeters) || candidate.distanceMeters <= entryDistanceMeters) continue;
    approaching.push({ candidate, entryDistanceMeters });
  }
  return approaching;
}
