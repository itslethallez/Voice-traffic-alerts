import { fetchFixedCameras, fetchOwnReports } from '../api/backend/client';
import { fetchAlertsForBoundingBox } from '../api/waze/fetchAlertsForBoundingBox';
import { WazeApiError } from '../api/waze/client';
import { getDeviceId } from '../config/deviceId';
import { FIXED_SPEED_CAMERAS, type FixedSpeedCamera } from '../data/fixedSpeedCameras';
import type { ManualReport } from '../store/useTripStore';
import { applyFetchResult, initialAlertsCache } from '../engine/cache';
import { initialMovementState, updateMovementState } from '../engine/movement';
import { planPoll } from '../engine/pollPlanner';
import { selectAnnounceableAlerts } from '../engine/selectAlerts';
import { selectBriefingAlerts } from '../engine/selectBriefingAlerts';
import {
  hasNearbyWarningTarget,
  selectSpeedCameraWarning,
  type SpeedWarningCheckpoint,
} from '../engine/selectSpeedCameraWarning';
import { initialSpeedState, isSustainedLowSpeed, updateSpeedState } from '../engine/speedGate';
import type { AlertsCache, DriverState, MovementState, SpeedState } from '../engine/types';
import type { WazeBoundingBoxParams } from '../geo/boundingBox';
import { radiusBoundingBox } from '../geo/radiusBoundingBox';
import { getCachedSpeedLimit, prefetchSpeedLimit } from '../geo/speedLimitLookup';
import { prefetchSuburb } from '../geo/suburbLookup';
import {
  createInitialAnnouncerState,
  speakBriefing,
  submitCandidates,
  tick,
  type AnnouncerState,
} from '../speech/announcer';
import { delay } from '../speech/delay';
import { formatBriefingAlert, NO_BRIEFING_ALERTS_MESSAGE } from '../speech/formatAnnouncement';
import { formatSpeedCameraWarning } from '../speech/formatSpeedCameraWarning';
import { speakAsync } from '../speech/ttsAdapter';
import { enabledTypesFromSettings } from '../store/settingsDefaults';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTripStore } from '../store/useTripStore';
import { computeRateLimitBackoffMs } from './backoff';
import {
  BRIEFING_FETCH_RETRY_INTERVAL_MS,
  BRIEFING_LOADING_BANNER_DELAY_MS,
  BRIEFING_MAX_FETCH_ATTEMPTS,
} from './constants';

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
/** Which speed-camera-warning checkpoints (500m/200m) have already fired
 * for which target id (a fixed camera or a corroborated police report)
 * this trip - see engine/selectSpeedCameraWarning.ts. */
let speedWarningFiredCheckpoints: Map<string, Set<SpeedWarningCheckpoint>> = new Map();

/**
 * null until a live fetch from the central `fixed_cameras` table succeeds
 * (Central Database brief) - getActiveFixedCameras() falls back to the
 * bundled FIXED_SPEED_CAMERAS constant until then, or forever if the
 * backend is unreachable, same offline-resilience pattern as the rest of
 * this file. Deliberately read through a function rather than a plain
 * variable snapshot of FIXED_SPEED_CAMERAS - tripRuntime.test.ts mocks
 * that import with a live getter, and a function call here (instead of
 * copying its value once at module load) keeps that mock working exactly
 * as before whenever the live fetch hasn't overridden it.
 */
let fetchedFixedCameras: FixedSpeedCamera[] | null = null;

function getActiveFixedCameras(): FixedSpeedCamera[] {
  return fetchedFixedCameras ?? FIXED_SPEED_CAMERAS;
}

async function refreshFixedCameras(): Promise<void> {
  try {
    const remote = await fetchFixedCameras();
    // An empty-but-successful response (table not populated yet, or a
    // scrape run that genuinely found nothing) must not override the
    // bundled fallback - `[] ?? FIXED_SPEED_CAMERAS` would otherwise
    // evaluate to `[]` (empty isn't null/undefined), silently disabling
    // every fixed-camera warning instead of falling back to the 92 bundled
    // ones. Only take over once there's real data to take over with.
    if (remote.length === 0) return;
    fetchedFixedCameras = remote.map((camera) => ({
      id: camera.id,
      label: camera.roadName,
      position: { latitude: camera.lat, longitude: camera.lng },
    }));
  } catch (error) {
    console.warn('[cameras] failed to fetch live fixed camera data, using bundled fallback', error);
  }
}

function toManualReport(remote: {
  id: string;
  createdAt: string;
  lat: number;
  lng: number;
  headingDeg: number | null;
}): ManualReport {
  return {
    id: remote.id,
    // A hydrated report's id never changes after this (no local-id swap to
    // reconcile, unlike pushManualReport's optimistic entries), so it's
    // already a stable key.
    localKey: remote.id,
    createdAtMs: new Date(remote.createdAt).getTime(),
    position: { latitude: remote.lat, longitude: remote.lng },
    headingDeg: remote.headingDeg,
  };
}

/** Restores this device's own past reports (Central Database brief) so
 * HistoryScreen isn't empty just because the app relaunched - manualReports
 * itself has no persistence of its own (see useTripStore.ts). */
async function hydrateManualReportsFromBackend(): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    const remoteReports = await fetchOwnReports(deviceId);
    useTripStore.getState().setManualReports(remoteReports.map(toManualReport));
  } catch (error) {
    console.warn('[reports] failed to hydrate manual reports from the backend', error);
  }
}

/** Call when a new trip starts (e.g. app cold start) to clear all of the above. */
export function resetTripRuntime(): void {
  announcerState = createInitialAnnouncerState();
  movementState = initialMovementState;
  speedState = initialSpeedState;
  alertsCache = initialAlertsCache;
  lastPollAttemptAtMs = null;
  consecutiveRateLimitHits = 0;
  rateLimitBannerShown = false;
  speedWarningFiredCheckpoints = new Map();
  // Also start a fresh serialization chain - otherwise a call already
  // queued behind the old chain (from before this reset) would still run
  // afterwards and write into the just-reset state.
  updateChain = Promise.resolve();
  // Radar UI mirror (Step 11) - drop the previous trip's alerts so a
  // fresh trip doesn't briefly show stale markers before the first fetch.
  useTripStore.getState().setVisibleAlerts([]);
  // History header's "THIS TRIP · {n} MIN" line (design_handoff_instrument_face).
  useTripStore.getState().setTripStartedAtMs(Date.now());

  // Both fire-and-forget: neither blocks trip start, both fall back to
  // already-in-memory/bundled data on failure (Central Database brief).
  void refreshFixedCameras();
  void hydrateManualReportsFromBackend();
}

const RATE_LIMIT_BANNER_MESSAGE = 'Requests are being limited. Retrying automatically.';
const BRIEFING_LOADING_BANNER_MESSAGE = 'Getting your briefing…';

/**
 * The actual fetch/cache/offline-state work, shared by pollIfDue's
 * cadence-gated normal polling and runBriefing's own retry policy below.
 * Returns whether the fetch succeeded - true even for a response with
 * zero alerts, false only on an actual failure - so callers can tell
 * "succeeded, nothing out there" apart from "didn't get an answer".
 */
async function fetchAndApplyAlerts(boundingBox: WazeBoundingBoxParams, nowMs: number): Promise<boolean> {
  lastPollAttemptAtMs = nowMs;

  try {
    const { alerts, quadrantRateLimited } = await fetchAlertsForBoundingBox(boundingBox);
    alertsCache = applyFetchResult(alertsCache, { ok: true, alerts, nowMs });
    useTripStore.getState().setOffline(false);
    useTripStore.getState().setVisibleAlerts(alertsCache.alerts);

    // Kick off suburb resolution as early as possible - fire-and-forget,
    // never awaited - so it has the whole announce-window approach (an
    // alert has to cross into range before it's ever spoken) to resolve
    // before formatAnnouncement.ts actually needs it. A no-op per alert if
    // already cached/in-flight (see geo/suburbLookup.ts's quantized cache).
    for (const alert of alerts) {
      prefetchSuburb({ latitude: alert.latitude, longitude: alert.longitude }).catch(() => {});
    }

    if (quadrantRateLimited) {
      // A quadrant came back 429 even though the call as a whole returned
      // usable data (the original 200 plus whatever other quadrants
      // succeeded) - still count this toward the backoff so a sustained
      // rate limit keeps slowing polling down, instead of looking like a
      // clean fetch and resetting straight back to zero.
      consecutiveRateLimitHits += 1;
      if (!rateLimitBannerShown) {
        useTripStore.getState().setBannerMessage(RATE_LIMIT_BANNER_MESSAGE);
        rateLimitBannerShown = true;
      }
    } else {
      consecutiveRateLimitHits = 0;
      if (rateLimitBannerShown) {
        // Only clear it if it's still showing the rate-limit text - the
        // banner is a single slot shared with e.g. the background-location
        // notice, and that may have been set after this one and shouldn't
        // be wiped by this unrelated recovery.
        if (useTripStore.getState().bannerMessage === RATE_LIMIT_BANNER_MESSAGE) {
          useTripStore.getState().setBannerMessage(null);
        }
        rateLimitBannerShown = false;
      }
    }
    return true;
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
    return false;
  }
}

async function pollIfDue(driver: DriverState, nowMs: number, announceDistanceMeters: number): Promise<void> {
  movementState = updateMovementState(movementState, driver.position, nowMs);
  const plan = planPoll(driver, movementState, nowMs, announceDistanceMeters);

  if (!plan.shouldPoll || !plan.boundingBox) return;

  // A rate-limit backoff overrides the normal moving/stationary cadence
  // while it's in effect; otherwise plan.intervalMs governs.
  const effectiveIntervalMs =
    consecutiveRateLimitHits > 0 ? computeRateLimitBackoffMs(consecutiveRateLimitHits) : plan.intervalMs;

  const isDue = lastPollAttemptAtMs === null || nowMs - lastPollAttemptAtMs >= effectiveIntervalMs;
  if (!isDue) return;

  await fetchAndApplyAlerts(plan.boundingBox, nowMs);
}

/**
 * Serializes handleDriverUpdate() calls. Once handed off to 'live'
 * (see useDriveLoop.ts), the foreground watchPositionAsync callback and
 * the background TaskManager task are both active at once and both call
 * handleDriverUpdate directly with no coordination between them - without
 * this, two overlapping calls could interleave their reads/writes of the
 * module-level announcerState/alertsCache/pollState (dequeue the same
 * alert twice, stomp each other's cache update, fire two polls at once).
 * Chaining every call through this promise forces them to run one at a
 * time, in call order, regardless of which source triggered them.
 */
let updateChain: Promise<void> = Promise.resolve();

export function handleDriverUpdate(driver: DriverState, nowMs: number): Promise<void> {
  const run = updateChain.then(() => handleDriverUpdateSerialized(driver, nowMs));
  // Swallow here so a rejected update doesn't poison the chain for
  // whatever call comes after it - handleDriverUpdateSerialized already
  // catches its own fetch/speech failures, so a rejection reaching this
  // point would be an unexpected bug, not routine unhappy-path behaviour.
  updateChain = run.catch(() => {});
  return run;
}

/**
 * Speed-camera / corroborated-police-report warning (Step 12 Part 4): only
 * fires while the driver is speedLimitKmh + SPEED_WARNING_BUFFER_KMH or
 * more, and only for a target within the live announce distance - never a
 * proximity-only "camera here" callout. Gated on the POLICE category
 * toggle, since a SAPOL camera is police-adjacent enforcement
 * infrastructure and a driver who's turned POLICE off has said "don't tell
 * me about police." The (comparatively expensive, rate-limited) OSM speed
 * limit lookup is only ever prefetched once hasNearbyWarningTarget already
 * confirms there's something worth warning about - most of a trip has no
 * nearby camera or corroborated report, so this keeps Overpass usage rare.
 * Speaks directly via speakAsync, bypassing the announcer's priority queue
 * (submitCandidates/tick) entirely - that queue's 20s MIN_ANNOUNCEMENT_GAP_MS
 * and distance-based dedupe don't fit this feature's own fixed 500m/200m
 * checkpoints (see engine/selectSpeedCameraWarning.ts).
 */
async function checkSpeedCameraWarning(
  driver: DriverState,
  nowMs: number,
  settings: ReturnType<typeof useSettingsStore.getState>
): Promise<void> {
  if (!settings.categoriesEnabled.POLICE) return;
  const cameras = getActiveFixedCameras();
  if (!hasNearbyWarningTarget(driver, cameras, alertsCache.alerts, nowMs)) return;

  prefetchSpeedLimit(driver.position).catch(() => {});
  const speedLimitKmh = getCachedSpeedLimit(driver.position) ?? null;

  const warning = selectSpeedCameraWarning({
    driver,
    speedLimitKmh,
    cameras,
    alerts: alertsCache.alerts,
    firedCheckpoints: speedWarningFiredCheckpoints,
    nowMs,
  });
  if (!warning) return;

  try {
    await speakAsync(formatSpeedCameraWarning(warning.target.kind), {
      rate: settings.voiceRate,
      volume: settings.voiceVolume,
    });
    // Only consumed on success - this is a safety-critical warning, so a
    // TTS failure (network hiccup, on-device speech error) must not
    // permanently silence it for the rest of the trip. Leaving the
    // checkpoint unmarked lets selectSpeedCameraWarning() offer it again on
    // the next GPS update instead.
    const fired = speedWarningFiredCheckpoints.get(warning.target.id) ?? new Set<SpeedWarningCheckpoint>();
    fired.add(warning.checkpoint);
    speedWarningFiredCheckpoints.set(warning.target.id, fired);
  } catch (error) {
    console.warn(`[speech] speed camera warning TTS failed for ${warning.target.id}`, error);
  }
}

/**
 * The single place a new driver position turns into "maybe fetch fresh
 * alerts, maybe speak one". Reads live settings and pushes to the trip
 * store itself (both are plain module-level stores, not React context,
 * so this works identically whether called from a hook's callback or a
 * background task with no React tree mounted at all). Only ever called
 * through handleDriverUpdate() above, which serializes it.
 */
async function handleDriverUpdateSerialized(driver: DriverState, nowMs: number): Promise<void> {
  // Radar UI mirror (Step 11) - read-only, doesn't affect any decision below.
  useTripStore.getState().setDriverPosition(driver.position, driver.headingDeg, driver.speedKmh);

  const settings = useSettingsStore.getState();
  await pollIfDue(driver, nowMs, settings.announceDistanceMeters);

  speedState = updateSpeedState(speedState, driver.speedKmh, nowMs);

  // "User is a passenger or on a train. Not solvable, but do not announce
  // below 15 km/h sustained." - data still stays fresh (pollIfDue above
  // ran regardless), only the speaking is suppressed.
  if (settings.masterMute || isSustainedLowSpeed(speedState, nowMs)) return;

  const candidates = selectAnnounceableAlerts(
    alertsCache.alerts,
    driver,
    announcerState.announcedDistances,
    nowMs,
    {
      enabledTypes: enabledTypesFromSettings(settings.categoriesEnabled),
      maxDistanceMeters: settings.announceDistanceMeters,
    }
  );
  announcerState = submitCandidates(announcerState, candidates);

  const result = await tick(
    announcerState,
    nowMs,
    { rate: settings.voiceRate, volume: settings.voiceVolume },
    // Real-time: push to the trip store the instant this is dispatched to
    // speech, not after the whole utterance finishes - otherwise the
    // on-screen card lags several seconds behind the voice.
    (entry) => useTripStore.getState().pushAnnouncement(entry)
  );
  announcerState = result.state;

  await checkSpeedCameraWarning(driver, nowMs, settings);
}

/**
 * Waits for a usable alerts cache before the briefing can select from it.
 * An already-populated cache (fetchedAtMs !== null - e.g. a fetch that
 * completed before this call, however unlikely on a true cold start) is
 * used immediately with no fetch at all. Otherwise this fetches with its
 * own short retry policy - independent of pollIfDue's cadence gating and
 * the multi-minute rate-limit backoff, both far too slow for a driver
 * waiting on the briefing to start - stopping the moment any attempt
 * succeeds, including one with zero alerts (a successful fetch, not a
 * failure). Surfaces BRIEFING_LOADING_BANNER_MESSAGE via the shared
 * bannerMessage slot if still waiting past BRIEFING_LOADING_BANNER_DELAY_MS,
 * and clears only that banner (checked by value, so a newer rate-limit,
 * offline, or background-location banner set in the meantime is left
 * alone) once done.
 *
 * Returns whether a usable cache exists by the end - true even if every
 * attempt in this call failed, as long as an earlier fetch already left
 * a cached result (applyFetchResult never clears alerts on failure, only
 * marks the cache stale), so the briefing can fall back to it.
 */
async function waitForBriefingAlerts(
  boundingBox: WazeBoundingBoxParams,
  signal: AbortSignal | undefined
): Promise<boolean> {
  if (alertsCache.fetchedAtMs !== null) return true;

  let loadingBannerShown = false;
  const bannerTimer = setTimeout(() => {
    if (signal?.aborted) return;
    useTripStore.getState().setBannerMessage(BRIEFING_LOADING_BANNER_MESSAGE);
    loadingBannerShown = true;
  }, BRIEFING_LOADING_BANNER_DELAY_MS);

  try {
    for (let attempt = 0; attempt < BRIEFING_MAX_FETCH_ATTEMPTS; attempt++) {
      if (signal?.aborted) break;

      const ok = await fetchAndApplyAlerts(boundingBox, Date.now());
      if (ok) break; // succeeded, even with zero alerts - stop immediately, no more retries

      const isLastAttempt = attempt === BRIEFING_MAX_FETCH_ATTEMPTS - 1;
      if (!isLastAttempt) {
        await delay(BRIEFING_FETCH_RETRY_INTERVAL_MS, signal);
      }
    }
  } finally {
    clearTimeout(bannerTimer);
    if (loadingBannerShown && useTripStore.getState().bannerMessage === BRIEFING_LOADING_BANNER_MESSAGE) {
      useTripStore.getState().setBannerMessage(null);
    }
  }

  return alertsCache.fetchedAtMs !== null;
}

export interface RunBriefingOptions {
  signal?: AbortSignal;
}

/**
 * The one-shot cold-start briefing: waits for a usable alerts cache (see
 * waitForBriefingAlerts) around driver.position - using
 * settings.briefingRadiusMeters, not the live-driving poll box, since the
 * briefing radius can be wider than the stationary poll box ever is -
 * then speaks the nearest qualifying alerts back to back via
 * speakBriefing. Deliberately does not touch selectAnnounceableAlerts or
 * tick, which stay live-driving only.
 *
 * Respects masterMute the same way handleDriverUpdate does (the cache
 * still refreshes; only speech is suppressed) and `signal` for
 * cancellation on unmount/teardown/lifecycle interruption - speakBriefing
 * and the retry/loading-banner wait above both already honour it.
 */
export async function runBriefing(
  driver: DriverState,
  nowMs: number,
  options: RunBriefingOptions = {}
): Promise<void> {
  const { signal } = options;
  const settings = useSettingsStore.getState();
  const boundingBox = radiusBoundingBox(driver.position, settings.briefingRadiusMeters);

  // Radar UI mirror (Step 11) - so the map has a driver position to
  // center on right away, before the first handleDriverUpdate() call.
  useTripStore.getState().setDriverPosition(driver.position, driver.headingDeg, driver.speedKmh);

  const hasUsableAlerts = await waitForBriefingAlerts(boundingBox, signal);
  if (signal?.aborted) return;
  if (settings.masterMute) return;

  const candidates = hasUsableAlerts
    ? selectBriefingAlerts(alertsCache.alerts, driver.position, Date.now(), {
        enabledTypes: enabledTypesFromSettings(settings.categoriesEnabled),
        radiusMeters: settings.briefingRadiusMeters,
      })
    : [];

  const speakOptions = { rate: settings.voiceRate, volume: settings.voiceVolume };

  if (candidates.length === 0) {
    if (signal?.aborted) return;
    try {
      await speakAsync(NO_BRIEFING_ALERTS_MESSAGE, speakOptions);
    } catch (error) {
      console.warn('[briefing] failed to speak the empty-briefing message', error);
    }
    return;
  }

  announcerState = await speakBriefing(announcerState, candidates, formatBriefingAlert, {
    speakOptions,
    signal,
    onItemSpoken: (entry) => useTripStore.getState().pushAnnouncement(entry),
  });
}
