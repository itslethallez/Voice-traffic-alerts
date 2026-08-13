import { mockAlerts } from '../api/waze/__mocks__/alerts.fixture';
import type { DriverState } from '../engine/types';
import { selectAnnounceableAlerts } from '../engine/selectAlerts';
import { createInitialAnnouncerState, submitCandidates, tick, type AnnouncerState } from '../speech/announcer';
import { enabledTypesFromSettings } from '../store/settingsDefaults';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTripStore } from '../store/useTripStore';

/**
 * Module-level (not React state) so it's reachable from both the
 * foreground location watch (a hook, has a component to hold refs in)
 * and the background location task (TaskManager.defineTask, a bare
 * module-scope callback with no component at all). A trip's pending
 * announcement queue and announced-alert dedupe need to be the same
 * object regardless of which one happens to receive a given location
 * fix, or switching between foreground and background mid-trip would
 * either double-announce or silently drop alerts.
 */
let announcerState: AnnouncerState = createInitialAnnouncerState();

/** Call when a new trip starts (e.g. app cold start) to clear dedupe/queue state. */
export function resetTripRuntime(): void {
  announcerState = createInitialAnnouncerState();
}

/**
 * The single place a new driver position turns into "maybe speak an
 * alert". Reads live settings and pushes to the trip store itself
 * (both are plain module-level stores, not React context, so this
 * works identically whether called from a hook's callback or a
 * background task with no React tree mounted at all).
 */
export async function handleDriverUpdate(driver: DriverState, nowMs: number): Promise<void> {
  const settings = useSettingsStore.getState();
  if (settings.masterMute) return;

  const candidates = selectAnnounceableAlerts(
    mockAlerts,
    driver,
    announcerState.announcedIds,
    nowMs,
    {
      enabledTypes: enabledTypesFromSettings(settings.categoriesEnabled),
      maxDistanceMeters: settings.announceDistanceMeters,
    }
  );
  announcerState = submitCandidates(announcerState, candidates);

  const result = await tick(announcerState, nowMs, {
    rate: settings.voiceRate,
    volume: settings.voiceVolume,
  });
  announcerState = result.state;

  if (result.spoken) {
    useTripStore.getState().pushAnnouncement(result.spoken);
  }
}
