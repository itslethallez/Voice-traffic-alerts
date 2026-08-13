import { buildMockAlerts, MOCK_DRIVER } from '../../api/waze/__mocks__/alerts.fixture';
import { WazeApiError } from '../../api/waze/client';
import { MOVING_POLL_INTERVAL_MS, SUSTAINED_LOW_SPEED_WINDOW_MS } from '../../engine/constants';
import type { DriverState } from '../../engine/types';
import { ALERT_CATEGORIES, defaultSettingsValues } from '../../store/settingsDefaults';
import { RATE_LIMIT_INITIAL_BACKOFF_MS } from '../backoff';

const pushAnnouncement = jest.fn();
const setOffline = jest.fn();
const setBannerMessage = jest.fn();
let settingsState = { ...defaultSettingsValues };

jest.mock('../../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settingsState },
}));

jest.mock('../../store/useTripStore', () => ({
  useTripStore: { getState: () => ({ pushAnnouncement, setOffline, setBannerMessage }) },
}));

const speakAsync = jest.fn().mockResolvedValue(undefined);
jest.mock('../../speech/ttsAdapter', () => ({
  speakAsync: (...args: [string, Record<string, unknown>?]) => speakAsync(...args),
}));

const fetchAlertsForBoundingBox = jest.fn();
jest.mock('../../api/waze/fetchAlertsForBoundingBox', () => ({
  fetchAlertsForBoundingBox: (...args: unknown[]) => fetchAlertsForBoundingBox(...args),
}));

import { handleDriverUpdate, resetTripRuntime } from '../tripRuntime';

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
    fetchAlertsForBoundingBox.mockReset();
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
