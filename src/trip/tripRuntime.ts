import { fetchAlertsForBoundingBox } from '../api/waze/fetchAlertsForBoundingBox';
import { WazeApiError } from '../api/waze/client';
import { applyFetchResult, initialAlertsCache } from '../engine/cache';
import { initialMovementState, updateMovementState } from '../engine/movement';
import { planPoll } from '../engine/pollPlanner';
import { selectAnnounceableAlerts } from '../engine/selectAlerts';
import { initialSpeedState, isSustainedLowSpeed, updateSpeedState } from '../engine/speedGate';
import type { AlertsCache, DriverState, MovementState, SpeedState } from '../engine/types';
import { createInitialAnnouncerState, submitCandidates, tick, type AnnouncerState } from '../speech/announcer';
import { enabledTypesFromSettings } from '../store/settingsDefaults';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTripStore } from '../store/useTripStore';
import { computeRateLimitBackoffMs } from './backoff';

/**
 * Module-level (not React state) so it's reachable from both the
 * foreground location watch (a hook, has a component to hold refs in)
 * and the background location task (TaskManager.defineTask, a bare
 * module-scope callback with no component at all). A trip's pending
 * announcement queue, announced-alert dedupe, movement history and
 * alerts cache need to be the same objects regardless of which one
 * happens to receive a given location fix, or switching between
 * foreground and background mid-trip would double-announce, lose
 * dedupe, or reset the poll cadence.
 */
let announcerState: AnnouncerState = createInitialAnnouncerState();
let movementState: MovementState = initialMovementState;
let speedState: SpeedState = initialSpeedState;
let alertsCache: AlertsCache = initialAlertsCache;
let lastPollAttemptAtMs: number | null = null;
let consecutiveRateLimitHits = 0;
let rateLimitBannerShown = false;

/** Call when a new trip starts (e.g. app cold start) to clear all of the above. */
export function resetTripRuntime(): void {
  announcerState = createInitialAnnouncerState();
  movementState = initialMovementState;
  speedState = initialSpeedState;
  alertsCache = initialAlertsCache;
  lastPollAttemptAtMs = null;
  consecutiveRateLimitHits = 0;
  rateLimitBannerShown = false;
}

const RATE_LIMIT_BANNER_MESSAGE = 'Requests are being limited. Retrying automatically.';

async function pollIfDue(driver: DriverState, nowMs: number): Promise<void> {
  movementState = updateMovementState(movementState, driver.position, nowMs);
  const plan = planPoll(driver, movementState, nowMs);

  if (!plan.shouldPoll || !plan.boundingBox) return;

  // A rate-limit backoff overrides the normal moving/stationary cadence
  // while it's in effect; otherwise plan.intervalMs governs.
  const effectiveIntervalMs =
    consecutiveRateLimitHits > 0 ? computeRateLimitBackoffMs(consecutiveRateLimitHits) : plan.intervalMs;

  const isDue = lastPollAttemptAtMs === null || nowMs - lastPollAttemptAtMs >= effectiveIntervalMs;
  if (!isDue) return;

  lastPollAttemptAtMs = nowMs;

  try {
    const alerts = await fetchAlertsForBoundingBox(plan.boundingBox);
    alertsCache = applyFetchResult(alertsCache, { ok: true, alerts, nowMs });
    consecutiveRateLimitHits = 0;
    useTripStore.getState().setOffline(false);
    if (rateLimitBannerShown) {
      useTripStore.getState().setBannerMessage(null);
      rateLimitBannerShown = false;
    }
  } catch (error) {
    alertsCache = applyFetchResult(alertsCache, { ok: false });

    if (error instanceof WazeApiError && error.isRateLimited) {
      consecutiveRateLimitHits += 1;
      if (!rateLimitBannerShown) {
        useTripStore.getState().setBannerMessage(RATE_LIMIT_BANNER_MESSAGE);
        rateLimitBannerShown = true;
      }
      // A rate limit isn't "offline" - the network is fine, keep serving cache quietly otherwise.
    } else {
      useTripStore.getState().setOffline(true);
    }
  }
}

/**
 * The single place a new driver position turns into "maybe fetch fresh
 * alerts, maybe speak one". Reads live settings and pushes to the trip
 * store itself (both are plain module-level stores, not React context,
 * so this works identically whether called from a hook's callback or a
 * background task with no React tree mounted at all).
 */
export async function handleDriverUpdate(driver: DriverState, nowMs: number): Promise<void> {
  await pollIfDue(driver, nowMs);

  speedState = updateSpeedState(speedState, driver.speedKmh, nowMs);

  const settings = useSettingsStore.getState();
  // "User is a passenger or on a train. Not solvable, but do not announce
  // below 15 km/h sustained." - data still stays fresh (pollIfDue above
  // ran regardless), only the speaking is suppressed.
  if (settings.masterMute || isSustainedLowSpeed(speedState, nowMs)) return;

  const candidates = selectAnnounceableAlerts(
    alertsCache.alerts,
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
