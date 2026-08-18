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
    fetchAlertsForBoundingBox.mockResolvedValue([]);
    await handleDriverUpdate(driver, Date.now());
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(1);
  });

  it('does not poll again before the moving interval has elapsed', async () => {
    fetchAlertsForBoundingBox.mockResolvedValue([]);
    const now = Date.now();
    await handleDriverUpdate(driver, now);
    await handleDriverUpdate(driver, now + 1000);
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(1);
  });

  it('polls again once the moving interval has elapsed', async () => {
    fetchAlertsForBoundingBox.mockResolvedValue([]);
    const now = Date.now();
    await handleDriverUpdate(driver, now);
    await handleDriverUpdate(driver, now + MOVING_POLL_INTERVAL_MS);
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(2);
  });

  it('announces the highest-severity alert from freshly-fetched alerts', async () => {
    const now = Date.now();
    fetchAlertsForBoundingBox.mockResolvedValue(buildMockAlerts(now));
    await handleDriverUpdate(driver, now);
    expect(pushAnnouncement).toHaveBeenCalledTimes(1);
    expect(pushAnnouncement.mock.calls[0][0].alertId).toBe('wm-012');
  });

  it('keeps serving cached alerts and marks offline on a network failure', async () => {
    const now = Date.now();
    fetchAlertsForBoundingBox.mockResolvedValueOnce(buildMockAlerts(now));
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

    fetchAlertsForBoundingBox.mockResolvedValueOnce([]);
    await handleDriverUpdate(driver, now + RATE_LIMIT_INITIAL_BACKOFF_MS);
    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(2);
    expect(setBannerMessage).toHaveBeenCalledWith(null);
  });

  it('respects a category filter from settings', async () => {
    const now = Date.now();
    fetchAlertsForBoundingBox.mockResolvedValue(buildMockAlerts(now));
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
    fetchAlertsForBoundingBox.mockResolvedValue(buildMockAlerts(now));

    await handleDriverUpdate(lowSpeedDriver, now);
    expect(pushAnnouncement).toHaveBeenCalledTimes(1); // not yet "sustained" on the very first low-speed sample

    pushAnnouncement.mockClear();
    const laterNow = now + SUSTAINED_LOW_SPEED_WINDOW_MS;
    fetchAlertsForBoundingBox.mockResolvedValue(buildMockAlerts(laterNow));
    await handleDriverUpdate(lowSpeedDriver, laterNow);

    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(2); // still polling
    expect(pushAnnouncement).not.toHaveBeenCalled(); // but suppressed from announcing
  });

  it('still polls (keeps data fresh) but does not announce when master mute is on', async () => {
    settingsState.masterMute = true;
    const now = Date.now();
    fetchAlertsForBoundingBox.mockResolvedValue(buildMockAlerts(now));

    await handleDriverUpdate(driver, now);

    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(1);
    expect(speakAsync).not.toHaveBeenCalled();
    expect(pushAnnouncement).not.toHaveBeenCalled();
  });
});

describe('runBriefing', () => {
  beforeEach(() => {
    resetTripRuntime();
    pushAnnouncement.mockClear();
    setOffline.mockClear();
    setBannerMessage.mockClear();
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
    fetchAlertsForBoundingBox.mockResolvedValue(buildMockAlerts(Date.now()));
    await handleDriverUpdate(driver, Date.now()); // seeds the cache
    fetchAlertsForBoundingBox.mockClear();

    const promise = runBriefing(driver, Date.now());
    await jest.advanceTimersByTimeAsync(GAP_ADVANCE_MS);
    await promise;

    expect(fetchAlertsForBoundingBox).not.toHaveBeenCalled();
  });

  it('does not retry after a successful fetch, even one with zero alerts', async () => {
    fetchAlertsForBoundingBox.mockResolvedValue([]);
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
    fetchAlertsForBoundingBox.mockResolvedValue(buildMockAlerts(Date.now()));
    settingsState.categoriesEnabled = Object.fromEntries(
      ALERT_CATEGORIES.map((c) => [c, false])
    ) as typeof settingsState.categoriesEnabled;

    await runBriefing(driver, Date.now());

    expect(speakAsync).toHaveBeenCalledTimes(1);
    expect(speakAsync).toHaveBeenCalledWith(NO_BRIEFING_ALERTS_MESSAGE, expect.anything());
  });

  it('is filtered by the configured briefing radius and capped at MAX_BRIEFING_ALERTS', async () => {
    fetchAlertsForBoundingBox.mockResolvedValue(buildMockAlerts(Date.now()));
    settingsState.briefingRadiusMeters = 2000;

    const promise = runBriefing(driver, Date.now());
    await jest.advanceTimersByTimeAsync(GAP_ADVANCE_MS);
    await promise;

    expect(speakAsync).toHaveBeenCalledTimes(MAX_BRIEFING_ALERTS);
  });

  it('does not speak when master mute is on, but still refreshes the cache', async () => {
    settingsState.masterMute = true;
    fetchAlertsForBoundingBox.mockResolvedValue(buildMockAlerts(Date.now()));

    await runBriefing(driver, Date.now());

    expect(fetchAlertsForBoundingBox).toHaveBeenCalledTimes(1);
    expect(speakAsync).not.toHaveBeenCalled();
  });

  it('marks briefed alerts as announced so live driving does not repeat them', async () => {
    const now = Date.now();
    fetchAlertsForBoundingBox.mockResolvedValue(buildMockAlerts(now));
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
    fetchAlertsForBoundingBox.mockResolvedValue(buildMockAlerts(Date.now()));
    const controller = new AbortController();
    controller.abort();

    await runBriefing(driver, Date.now(), { signal: controller.signal });

    expect(fetchAlertsForBoundingBox).not.toHaveBeenCalled();
    expect(speakAsync).not.toHaveBeenCalled();
  });
});
