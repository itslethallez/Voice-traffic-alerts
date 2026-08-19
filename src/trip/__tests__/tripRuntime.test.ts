import { buildMockAlerts, MOCK_DRIVER } from '../../api/waze/__mocks__/alerts.fixture';
import { WazeApiError } from '../../api/waze/client';
import { MAX_BRIEFING_ALERTS, MOVING_POLL_INTERVAL_MS, SUSTAINED_LOW_SPEED_WINDOW_MS } from '../../engine/constants';
import type { DriverState } from '../../engine/types';
import { NO_BRIEFING_ALERTS_MESSAGE } from '../../speech/formatAnnouncement';
import { BRIEFING_GAP_MS } from '../../speech/constants';
import { ALERT_CATEGORIES, defaultSettingsValues } from '../../store/settingsDefaults';
import { RATE_LIMIT_INITIAL_BACKOFF_MS } from '../backoff';
import { BRIEFING_FETCH_RETRY_INTERVAL_MS, BRIEFING_LOADING_BANNER_DELAY_MS, BRIEFING_MAX_FETCH_ATTEMPTS } from '../constants';

const pushAnnouncement = jest.fn();
const setOffline = jest.fn();
const setDriverPosition = jest.fn();
const setVisibleAlerts = jest.fn();
let tripBannerMessage: string | null = null;
const setBannerMessage = jest.fn((message: string | null) => {
  tripBannerMessage = message;
});
let settingsState = { ...defaultSettingsValues };

jest.mock('../../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settingsState },
}));

jest.mock('../../store/useTripStore', () => ({
  useTripStore: {
    getState: () => ({
      pushAnnouncement,
      setOffline,
      setBannerMessage,
      setDriverPosition,
      setVisibleAlerts,
      get bannerMessage() {
        return tripBannerMessage;
      },
    }),
  },
}));

const speakAsync = jest.fn().mockResolvedValue(undefined);
const stopSpeaking = jest.fn().mockResolvedValue(undefined);
jest.mock('../../speech/ttsAdapter', () => ({
  speakAsync: (...args: [string, Record<string, unknown>?]) => speakAsync(...args),
  stopSpeaking: () => stopSpeaking(),
}));

const fetchAlertsForBoundingBox = jest.fn();
/** Wraps a plain alerts array as the { alerts, quadrantRateLimited } shape fetchAlertsForBoundingBox actually returns. */
function ok(alerts: unknown[]): { alerts: unknown[]; quadrantRateLimited: boolean } {
  return { alerts, quadrantRateLimited: false };
}
jest.mock('../../api/waze/fetchAlertsForBoundingBox', () => ({
  fetchAlertsForBoundingBox: (...args: unknown[]) => fetchAlertsForBoundingBox(...args),
}));

import { handleDriverUpdate, resetTripRuntime, runBriefing } from '../tripRuntime';

const driver: DriverState = {
  position: { latitude: MOCK_DRIVER.latitude, longitude: MOCK_DRIVER.longitude },
  headingDeg: MOCK_DRIVER.heading,
  speedKmh: 60, // moving, so the 45s cadence applies
};

describe('handleDriverUpdate', () => {
  beforeEach(() => {
    resetTripRuntime();
    pushAnnouncement.mockClear();
    setOffline.mockClear();
    setBannerMessage.mockClear();
    setDriverPosition.mockClear();
    setVisibleAlerts.mockClear();
    speakAsync.mockClear();
    stopSpeaking.mockClear();
    fetchAlertsForBoundingBox.mockReset();
    tripBannerMessage = null;
    settingsState = {
      ...defaultSettingsValues,
      categoriesEnabled: { ...defaultSettingsValues.categoriesEnabled },
    };
  });

  it('polls immediately on the first update', async () => {
    fetchAlertsForBoundingBox.mockResolvedValue(ok([]));
    await handleDriverUpdate(driver, Date.now());
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(1);
  });

  it('does not poll again before the moving interval has elapsed', async () => {
    fetchAlertsForBoundingBox.mockResolvedValue(ok([]));
    const now = Date.now();
    await handleDriverUpdate(driver, now);
    await handleDriverUpdate(driver, now + 1000);
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(1);
  });

  it('polls again once the moving interval has elapsed', async () => {
    fetchAlertsForBoundingBox.mockResolvedValue(ok([]));
    const now = Date.now();
    await handleDriverUpdate(driver, now);
    await handleDriverUpdate(driver, now + MOVING_POLL_INTERVAL_MS);
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(2);
  });

  it('announces the highest-severity alert from freshly-fetched alerts', async () => {
    const now = Date.now();
    fetchAlertsForBoundingBox.mockResolvedValue(ok(buildMockAlerts(now)));
    await handleDriverUpdate(driver, now);
    expect(pushAnnouncement).toHaveBeenCalledTimes(1);
    expect(pushAnnouncement.mock.calls[0][0].alertId).toBe('wm-012');
  });

  it('mirrors the driver position and freshly-fetched alerts into the trip store for the radar UI', async () => {
    const now = Date.now();
    const mockAlerts = buildMockAlerts(now);
    fetchAlertsForBoundingBox.mockResolvedValue(ok(mockAlerts));

    await handleDriverUpdate(driver, now);

    expect(setDriverPosition).toHaveBeenCalledWith(driver.position, driver.headingDeg);
    expect(setVisibleAlerts).toHaveBeenCalledWith(mockAlerts);
  });

  it('keeps serving cached alerts and marks offline on a network failure', async () => {
    const now = Date.now();
    fetchAlertsForBoundingBox.mockResolvedValueOnce(ok(buildMockAlerts(now)));
    await handleDriverUpdate(driver, now); // seeds the cache, announces wm-012

    fetchAlertsForBoundingBox.mockRejectedValueOnce(new WazeApiError('network down', null));
    await handleDriverUpdate(driver, now + MOVING_POLL_INTERVAL_MS);

    expect(setOffline).toHaveBeenCalledWith(true);
    // still able to select from the stale cache - wm-012 already announced, next is wm-002
    expect(pushAnnouncement).toHaveBeenCalledTimes(2);
    expect(pushAnnouncement.mock.calls[1][0].alertId).toBe('wm-002');
  });

  it('shows the rate-limit banner once and backs off, without marking offline', async () => {
    const now = Date.now();
    fetchAlertsForBoundingBox.mockRejectedValue(new WazeApiError('rate limited', 429));

    await handleDriverUpdate(driver, now);
    expect(setBannerMessage).toHaveBeenCalledTimes(1);
    expect(setOffline).not.toHaveBeenCalledWith(true);

    // too soon for the backoff window - no second poll attempt, no repeat banner call
    await handleDriverUpdate(driver, now + 5000);
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(1);
    expect(setBannerMessage).toHaveBeenCalledTimes(1);
  });

  it('retries after the backoff window and clears the banner on success', async () => {
    const now = Date.now();
    fetchAlertsForBoundingBox.mockRejectedValueOnce(new WazeApiError('rate limited', 429));
    await handleDriverUpdate(driver, now);
    expect(setBannerMessage).toHaveBeenCalledWith('Requests are being limited. Retrying automatically.');

    fetchAlertsForBoundingBox.mockResolvedValueOnce(ok([]));
    await handleDriverUpdate(driver, now + RATE_LIMIT_INITIAL_BACKOFF_MS);
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(2);
    expect(setBannerMessage).toHaveBeenCalledWith(null);
  });

  it('keeps counting toward the backoff when a quadrant comes back 429, even though the merged fetch "succeeds"', async () => {
    const now = Date.now();
    // Both attempts return usable data (the call as a whole succeeds) but
    // flag that a quadrant was rate-limited - this must still count
    // against the backoff, not reset it to zero like a clean fetch would.
    fetchAlertsForBoundingBox.mockResolvedValue({ alerts: [], quadrantRateLimited: true });

    await handleDriverUpdate(driver, now);
    expect(setBannerMessage).toHaveBeenCalledWith('Requests are being limited. Retrying automatically.');

    await handleDriverUpdate(driver, now + RATE_LIMIT_INITIAL_BACKOFF_MS);
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(2);

    // Second consecutive hit doubles the backoff to 120s - a poll only
    // 60s after the second attempt must not fire yet. If the quadrant
    // 429 had wrongly reset consecutiveRateLimitHits to 0, this next call
    // would be "due" under the normal moving cadence instead and poll again.
    await handleDriverUpdate(driver, now + RATE_LIMIT_INITIAL_BACKOFF_MS * 2);
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(2);
  });

  it('respects a category filter from settings', async () => {
    const now = Date.now();
    fetchAlertsForBoundingBox.mockResolvedValue(ok(buildMockAlerts(now)));
    settingsState.categoriesEnabled = Object.fromEntries(
      ALERT_CATEGORIES.map((c) => [c, c === 'JAM'])
    ) as typeof settingsState.categoriesEnabled;

    await handleDriverUpdate(driver, now);
    expect(pushAnnouncement.mock.calls[0][0].alertId).toBe('wm-010'); // closest qualifying JAM
  });

  it('suppresses announcements once low speed has been sustained, but keeps polling', async () => {
    // Passenger/train edge case: below 15 km/h but above the 5 km/h
    // stationary threshold, so the moving poll cadence still applies -
    // only the speech gate should react to sustained low speed.
    const lowSpeedDriver: DriverState = { ...driver, speedKmh: 10 };
    const now = Date.now();
    fetchAlertsForBoundingBox.mockResolvedValue(ok(buildMockAlerts(now)));

    await handleDriverUpdate(lowSpeedDriver, now);
    expect(pushAnnouncement).toHaveBeenCalledTimes(1); // not yet "sustained" on the very first low-speed sample

    pushAnnouncement.mockClear();
    const laterNow = now + SUSTAINED_LOW_SPEED_WINDOW_MS;
    fetchAlertsForBoundingBox.mockResolvedValue(ok(buildMockAlerts(laterNow)));
    await handleDriverUpdate(lowSpeedDriver, laterNow);

    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(2); // still polling
    expect(pushAnnouncement).not.toHaveBeenCalled(); // but suppressed from announcing
  });

  it('still polls (keeps data fresh) but does not announce when master mute is on', async () => {
    settingsState.masterMute = true;
    const now = Date.now();
    fetchAlertsForBoundingBox.mockResolvedValue(ok(buildMockAlerts(now)));

    await handleDriverUpdate(driver, now);

    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(1);
    expect(speakAsync).not.toHaveBeenCalled();
    expect(pushAnnouncement).not.toHaveBeenCalled();
  });

  it('does not clear a newer banner that replaced the rate-limit banner', async () => {
    const now = Date.now();
    fetchAlertsForBoundingBox.mockRejectedValueOnce(new WazeApiError('rate limited', 429));
    await handleDriverUpdate(driver, now);
    expect(tripBannerMessage).toBe('Requests are being limited. Retrying automatically.');

    // Something else (e.g. the background-location banner) takes the
    // shared slot before the rate limit clears.
    setBannerMessage('Some other banner');

    fetchAlertsForBoundingBox.mockResolvedValueOnce(ok([]));
    await handleDriverUpdate(driver, now + RATE_LIMIT_INITIAL_BACKOFF_MS);

    expect(tripBannerMessage).toBe('Some other banner');
  });

  it('serializes overlapping updates so a slow first call fully finishes before a second one begins', async () => {
    const now = Date.now();
    let resolveFirstFetch: (result: ReturnType<typeof ok>) => void = () => {};
    const firstFetchGate = new Promise<ReturnType<typeof ok>>((resolve) => {
      resolveFirstFetch = resolve;
    });

    fetchAlertsForBoundingBox
      .mockImplementationOnce(() => firstFetchGate)
      .mockResolvedValueOnce(ok(buildMockAlerts(now + MOVING_POLL_INTERVAL_MS)));

    // Simulates the foreground watch and the background task each
    // delivering a fix without waiting on each other.
    const first = handleDriverUpdate(driver, now);
    const second = handleDriverUpdate(driver, now + MOVING_POLL_INTERVAL_MS);

    // Let already-resolved microtasks drain. The first call should be
    // stuck on the gate; without serialization the second call would
    // already have reached its own fetch by now (its nowMs is far
    // enough past `now` to be due on its own), since nothing would be
    // holding it back.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(1);

    resolveFirstFetch(ok(buildMockAlerts(now)));
    await Promise.all([first, second]);

    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(2);
  });

  it('does not leave a fresh update stuck behind one still queued from before a reset', async () => {
    const now = Date.now();
    let resolveStaleFetch: (result: ReturnType<typeof ok>) => void = () => {};
    const staleFetchGate = new Promise<ReturnType<typeof ok>>((resolve) => {
      resolveStaleFetch = resolve;
    });

    fetchAlertsForBoundingBox
      .mockImplementationOnce(() => staleFetchGate)
      .mockResolvedValueOnce(ok([]));

    // Kick off an update but never let its fetch resolve yet - simulates
    // a call still queued on the serialization chain (e.g. a slow
    // in-flight fetch) right as a new trip starts and resets the runtime.
    const stale = handleDriverUpdate(driver, now);

    resetTripRuntime();

    // A fresh update issued after the reset must run its own fetch right
    // away, not sit blocked behind the still-pending stale one.
    const fresh = handleDriverUpdate(driver, now + MOVING_POLL_INTERVAL_MS);
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(2);

    resolveStaleFetch(ok([]));
    await Promise.all([stale, fresh]);
  });

  it('resetTripRuntime clears the radar UI alerts mirror so a new trip does not briefly show stale markers', async () => {
    fetchAlertsForBoundingBox.mockResolvedValue(ok(buildMockAlerts(Date.now())));
    await handleDriverUpdate(driver, Date.now());
    expect(setVisibleAlerts).toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]));

    setVisibleAlerts.mockClear();
    resetTripRuntime();

    expect(setVisibleAlerts).toHaveBeenCalledWith([]);
  });
});

describe('runBriefing', () => {
  beforeEach(() => {
    resetTripRuntime();
    pushAnnouncement.mockClear();
    setOffline.mockClear();
    setBannerMessage.mockClear();
    setDriverPosition.mockClear();
    setVisibleAlerts.mockClear();
    speakAsync.mockClear();
    stopSpeaking.mockClear();
    fetchAlertsForBoundingBox.mockReset();
    tripBannerMessage = null;
    settingsState = {
      ...defaultSettingsValues,
      categoriesEnabled: { ...defaultSettingsValues.categoriesEnabled },
    };
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Generously covers every inter-item gap speakBriefing() could insert
  // for up to MAX_BRIEFING_ALERTS items, so tests that speak more than
  // one item don't hang waiting on a fake timer nothing ever advances.
  const GAP_ADVANCE_MS = BRIEFING_GAP_MS * MAX_BRIEFING_ALERTS;

  it('uses a previously populated cache immediately, without fetching again', async () => {
    fetchAlertsForBoundingBox.mockResolvedValue(ok(buildMockAlerts(Date.now())));
    await handleDriverUpdate(driver, Date.now()); // seeds the cache
    fetchAlertsForBoundingBox.mockClear();

    const promise = runBriefing(driver, Date.now());
    await jest.advanceTimersByTimeAsync(GAP_ADVANCE_MS);
    await promise;

    expect(fetchAlertsForBoundingBox).not.toHaveBeenCalled();
  });

  it('does not retry after a successful fetch, even one with zero alerts', async () => {
    fetchAlertsForBoundingBox.mockResolvedValue(ok([]));
    await runBriefing(driver, Date.now());
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(1);
  });

  it('retries failed attempts at the specified interval, up to the maximum', async () => {
    fetchAlertsForBoundingBox.mockRejectedValue(new WazeApiError('network down', null));

    const promise = runBriefing(driver, Date.now());
    await jest.advanceTimersByTimeAsync(
      BRIEFING_FETCH_RETRY_INTERVAL_MS * (BRIEFING_MAX_FETCH_ATTEMPTS - 1) + 100
    );
    await promise;

    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(BRIEFING_MAX_FETCH_ATTEMPTS);
  });

  it('shows the loading banner once still waiting past 2 seconds, and clears it when done', async () => {
    fetchAlertsForBoundingBox.mockRejectedValue(new WazeApiError('network down', null));

    const promise = runBriefing(driver, Date.now());
    await jest.advanceTimersByTimeAsync(BRIEFING_LOADING_BANNER_DELAY_MS);
    expect(setBannerMessage).toHaveBeenCalledWith('Getting your briefing…');

    await jest.advanceTimersByTimeAsync(
      BRIEFING_FETCH_RETRY_INTERVAL_MS * (BRIEFING_MAX_FETCH_ATTEMPTS - 1)
    );
    await promise;

    expect(tripBannerMessage).toBeNull();
  });

  it('does not clear a newer banner that replaced the briefing loading banner', async () => {
    fetchAlertsForBoundingBox.mockRejectedValue(new WazeApiError('network down', null));

    const promise = runBriefing(driver, Date.now());
    await jest.advanceTimersByTimeAsync(BRIEFING_LOADING_BANNER_DELAY_MS);
    expect(tripBannerMessage).toBe('Getting your briefing…');

    // Something else (e.g. the background-location banner) takes the
    // slot before the briefing's own wait finishes.
    setBannerMessage('Some other banner');

    await jest.advanceTimersByTimeAsync(
      BRIEFING_FETCH_RETRY_INTERVAL_MS * (BRIEFING_MAX_FETCH_ATTEMPTS - 1)
    );
    await promise;

    expect(tripBannerMessage).toBe('Some other banner');
  });

  it('continues with an empty briefing and hands off normally when every attempt fails', async () => {
    fetchAlertsForBoundingBox.mockRejectedValue(new WazeApiError('network down', null));

    const promise = runBriefing(driver, Date.now());
    await jest.advanceTimersByTimeAsync(
      BRIEFING_FETCH_RETRY_INTERVAL_MS * (BRIEFING_MAX_FETCH_ATTEMPTS - 1) + 100
    );
    await promise;

    expect(speakAsync).toHaveBeenCalledWith(NO_BRIEFING_ALERTS_MESSAGE, expect.anything());
  });

  it('speaks the explicit no-alerts message when the cache has data but nothing qualifies', async () => {
    fetchAlertsForBoundingBox.mockResolvedValue(ok(buildMockAlerts(Date.now())));
    settingsState.categoriesEnabled = Object.fromEntries(
      ALERT_CATEGORIES.map((c) => [c, false])
    ) as typeof settingsState.categoriesEnabled;

    await runBriefing(driver, Date.now());

    expect(speakAsync).toHaveBeenCalledTimes(1);
    expect(speakAsync).toHaveBeenCalledWith(NO_BRIEFING_ALERTS_MESSAGE, expect.anything());
  });

  it('is filtered by the configured briefing radius and capped at MAX_BRIEFING_ALERTS', async () => {
    fetchAlertsForBoundingBox.mockResolvedValue(ok(buildMockAlerts(Date.now())));
    settingsState.briefingRadiusMeters = 2000;

    const promise = runBriefing(driver, Date.now());
    await jest.advanceTimersByTimeAsync(GAP_ADVANCE_MS);
    await promise;

    expect(speakAsync).toHaveBeenCalledTimes(MAX_BRIEFING_ALERTS);
  });

  it('does not speak when master mute is on, but still refreshes the cache', async () => {
    settingsState.masterMute = true;
    fetchAlertsForBoundingBox.mockResolvedValue(ok(buildMockAlerts(Date.now())));

    await runBriefing(driver, Date.now());

    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(1);
    expect(speakAsync).not.toHaveBeenCalled();
  });

  it('marks briefed alerts as announced so live driving does not repeat them', async () => {
    const now = Date.now();
    fetchAlertsForBoundingBox.mockResolvedValue(ok(buildMockAlerts(now)));
    settingsState.briefingRadiusMeters = 5000; // wide enough to cover the whole fixture

    const briefingPromise = runBriefing(driver, now);
    await jest.advanceTimersByTimeAsync(GAP_ADVANCE_MS);
    await briefingPromise;
    const briefedIds = new Set(pushAnnouncement.mock.calls.map((call) => call[0].alertId));
    expect(briefedIds.size).toBeGreaterThan(0);
    pushAnnouncement.mockClear();

    // selectAnnounceableAlerts's existing announcedIds dedupe should
    // exclude anything the briefing already covered - no separate
    // dedupe logic needed here.
    await handleDriverUpdate(driver, now + MOVING_POLL_INTERVAL_MS);
    const laterIds = pushAnnouncement.mock.calls.map((call) => call[0].alertId);

    for (const id of laterIds) {
      expect(briefedIds.has(id)).toBe(false);
    }
  });

  it('stops promptly and speaks nothing when the signal is already aborted', async () => {
    fetchAlertsForBoundingBox.mockResolvedValue(ok(buildMockAlerts(Date.now())));
    const controller = new AbortController();
    controller.abort();

    await runBriefing(driver, Date.now(), { signal: controller.signal });

    expect(fetchAlertsForBoundingBox).not.toHaveBeenCalled();
    expect(speakAsync).not.toHaveBeenCalled();
  });

  it('mirrors the driver position into the trip store immediately, before the briefing fetch resolves', async () => {
    fetchAlertsForBoundingBox.mockRejectedValue(new WazeApiError('network down', null));

    const promise = runBriefing(driver, Date.now());
    // Not awaiting the fetch retries at all - the mirror should already
    // have happened by the time the very first await inside runBriefing yields.
    expect(setDriverPosition).toHaveBeenCalledWith(driver.position, driver.headingDeg);

    await jest.advanceTimersByTimeAsync(
      BRIEFING_FETCH_RETRY_INTERVAL_MS * (BRIEFING_MAX_FETCH_ATTEMPTS - 1) + 100
    );
    await promise;
  });
});
