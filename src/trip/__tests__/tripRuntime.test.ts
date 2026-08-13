import { MOCK_DRIVER } from '../../api/waze/__mocks__/alerts.fixture';
import type { DriverState } from '../../engine/types';
import { ALERT_CATEGORIES, defaultSettingsValues } from '../../store/settingsDefaults';

const pushAnnouncement = jest.fn();
let settingsState = { ...defaultSettingsValues };

jest.mock('../../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settingsState },
}));

jest.mock('../../store/useTripStore', () => ({
  useTripStore: { getState: () => ({ pushAnnouncement }) },
}));

const speakAsync = jest.fn().mockResolvedValue(undefined);
jest.mock('../../speech/ttsAdapter', () => ({
  speakAsync: (...args: [string, Record<string, unknown>?]) => speakAsync(...args),
}));

import { handleDriverUpdate, resetTripRuntime } from '../tripRuntime';

const driver: DriverState = {
  position: { latitude: MOCK_DRIVER.latitude, longitude: MOCK_DRIVER.longitude },
  headingDeg: MOCK_DRIVER.heading,
  speedKmh: 60,
};

describe('handleDriverUpdate', () => {
  beforeEach(() => {
    resetTripRuntime();
    pushAnnouncement.mockClear();
    speakAsync.mockClear();
    settingsState = { ...defaultSettingsValues, categoriesEnabled: { ...defaultSettingsValues.categoriesEnabled } };
  });

  it('does nothing when master mute is on', async () => {
    settingsState.masterMute = true;
    await handleDriverUpdate(driver, Date.now());
    expect(speakAsync).not.toHaveBeenCalled();
    expect(pushAnnouncement).not.toHaveBeenCalled();
  });

  it('announces the highest-severity qualifying alert with default settings', async () => {
    await handleDriverUpdate(driver, Date.now());
    expect(speakAsync).toHaveBeenCalledTimes(1);
    expect(pushAnnouncement).toHaveBeenCalledTimes(1);
    expect(pushAnnouncement.mock.calls[0][0].alertId).toBe('wm-012'); // closest-qualifying ACCIDENT wins severity order
  });

  it('respects a category filter from settings', async () => {
    settingsState.categoriesEnabled = Object.fromEntries(
      ALERT_CATEGORIES.map((c) => [c, c === 'JAM'])
    ) as typeof settingsState.categoriesEnabled;

    await handleDriverUpdate(driver, Date.now());
    expect(pushAnnouncement).toHaveBeenCalledTimes(1);
    expect(pushAnnouncement.mock.calls[0][0].alertId).toBe('wm-010'); // closest qualifying JAM
  });

  it('respects an announcement distance override from settings that excludes everything', async () => {
    settingsState.announceDistanceMeters = 1; // below the fixed 300m floor - nothing can qualify
    await handleDriverUpdate(driver, Date.now());
    expect(speakAsync).not.toHaveBeenCalled();
    expect(pushAnnouncement).not.toHaveBeenCalled();
  });

  it('passes voice volume/rate from settings through to speech', async () => {
    settingsState.voiceRate = 1.5;
    settingsState.voiceVolume = 0.4;
    await handleDriverUpdate(driver, Date.now());
    expect(speakAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ rate: 1.5, volume: 0.4 })
    );
  });
});
