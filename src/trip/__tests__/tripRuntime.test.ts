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
const setTripStartedAtMs = jest.fn();
const setManualReports = jest.fn();
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
      setTripStartedAtMs,
      setManualReports,
      get bannerMessage() {
        return tripBannerMessage;
      },
    }),
  },
}));

/**
 * Central Database brief: resetTripRuntime() also fires off a live camera
 * fetch and a manual-reports hydration in the background. fetchFixedCameras
 * is mocked to always reject, deliberately - if it ever resolved, a
 * fire-and-forget refreshFixedCameras() call from an earlier test's
 * beforeEach could race a later test's synchronous `mockCameras = [...]`
 * assignment (see the live FIXED_SPEED_CAMERAS getter mock below) and pin
 * getActiveFixedCameras() to the fetched value, silently breaking every
 * test that depends on mockCameras. Rejecting keeps tripRuntime.ts's own
 * bundled-fallback path in play, which is what every test below actually
 * exercises (and matches this suite having no real network anyway).
 */
const fetchFixedCameras = jest.fn().mockRejectedValue(new Error('not mocked in this test'));
const fetchOwnReports = jest.fn().mockResolvedValue([]);
jest.mock('../../api/backend/client', () => ({
  fetchFixedCameras: (...args: unknown[]) => fetchFixedCameras(...args),
  fetchOwnReports: (...args: unknown[]) => fetchOwnReports(...args),
}));

const getDeviceId = jest.fn().mockResolvedValue('test-device-id');
jest.mock('../../config/deviceId', () => ({
  getDeviceId: () => getDeviceId(),
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

/**
 * Without this mock, the alerts fixture's own wm-006 (a POLICE report only
 * ~150m from MOCK_DRIVER, thumbs-up 1, reliability 5 - corroborated per
 * engine/selectSpeedCameraWarning.ts's bar) would make every existing test
 * above that uses buildMockAlerts() a real nearby warning target, firing a
 * genuine network call to Overpass via geo/speedLimitLookup.ts. Mocked to
 * "unresolved" (undefined) by default so speedLimitKmh reads null and
 * selectSpeedCameraWarning() never fires unless a test explicitly opts in
 * by setting mockSpeedLimitKmh.
 */
const prefetchSpeedLimit = jest.fn().mockResolvedValue(undefined);
let mockSpeedLimitKmh: number | null | undefined;
jest.mock('../../geo/speedLimitLookup', () => ({
  prefetchSpeedLimit: (...args: unknown[]) => prefetchSpeedLimit(...args),
  getCachedSpeedLimit: () => mockSpeedLimitKmh,
}));

/** Real FIXED_SPEED_CAMERAS is genuine South Australian data, nowhere near
 * MOCK_DRIVER's San Francisco test coordinates - mocked to an empty array
 * by default, overridable per test for the dedicated speed-camera-warning
 * cases below. */
let mockCameras: Array<{ id: string; label: string; type: string; position: { latitude: number; longitude: number } }> =
  [];
jest.mock('../../data/fixedSpeedCameras', () => ({
  get FIXED_SPEED_CAMERAS() {
    return mockCameras;
  },
}));

import { destinationPoint } from '../../geo/destination';
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
    setTripStartedAtMs.mockClear();
    speakAsync.mockClear();
    stopSpeaking.mockClear();
    fetchAlertsForBoundingBox.mockReset();
    prefetchSpeedLimit.mockClear();
    mockSpeedLimitKmh = undefined;
    mockCameras = [];
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

    expect(setDriverPosition).toHaveBeenCalledWith(driver.position, driver.headingDeg, driver.speedKmh);
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
    setTripStartedAtMs.mockClear();
    resetTripRuntime();

    expect(setVisibleAlerts).toHaveBeenCalledWith([]);
  });
});

describe('speed camera warning', () => {
  beforeEach(() => {
    resetTripRuntime();
    speakAsync.mockClear();
    fetchAlertsForBoundingBox.mockReset();
    fetchAlertsForBoundingBox.mockResolvedValue(ok([])); // no Waze alerts - isolates the camera/report targets these tests set up directly
    prefetchSpeedLimit.mockClear();
    mockSpeedLimitKmh = undefined;
    mockCameras = [];
    settingsState = {
      ...defaultSettingsValues,
      categoriesEnabled: { ...defaultSettingsValues.categoriesEnabled },
    };
  });

  /** A driver `distanceMeters` south of the camera, heading north (0deg) -
   * i.e. approaching it head-on, well within the 45-degree announce cone. */
  function approachingDriver(distanceMeters: number, speedKmh: number): DriverState {
    return {
      position: destinationPoint(MOCK_DRIVER_POSITION, distanceMeters, 180),
      headingDeg: 0,
      speedKmh,
    };
  }

  const MOCK_DRIVER_POSITION = { latitude: MOCK_DRIVER.latitude, longitude: MOCK_DRIVER.longitude };
  const TEST_CAMERA = {
    id: 'sapol-test',
    label: 'Test Rd, TESTVILLE',
    type: 'MID_BLOCK',
    position: MOCK_DRIVER_POSITION,
  };

  it('speaks the camera warning when speeding and within 500m of a known fixed camera', async () => {
    mockCameras = [TEST_CAMERA];
    mockSpeedLimitKmh = 60;

    await handleDriverUpdate(approachingDriver(450, 100), Date.now());

    expect(speakAsync).toHaveBeenCalledWith(
      expect.stringContaining('Speed camera ahead'),
      expect.anything()
    );
  });

  it('does not warn when under the speeding buffer', async () => {
    mockCameras = [TEST_CAMERA];
    mockSpeedLimitKmh = 60;

    await handleDriverUpdate(approachingDriver(450, 63), Date.now()); // 3 km/h over - under the 6 km/h buffer

    expect(speakAsync).not.toHaveBeenCalled();
  });

  it('does not warn when the POLICE category is disabled in Settings', async () => {
    mockCameras = [TEST_CAMERA];
    mockSpeedLimitKmh = 60;
    settingsState.categoriesEnabled.POLICE = false;

    await handleDriverUpdate(approachingDriver(450, 100), Date.now());

    expect(speakAsync).not.toHaveBeenCalled();
    expect(prefetchSpeedLimit).not.toHaveBeenCalled(); // shouldn't even bother resolving the limit
  });

  it('does not warn while the speed limit is still unresolved, but does trigger a prefetch', async () => {
    mockCameras = [TEST_CAMERA];
    // mockSpeedLimitKmh left undefined - simulates "prefetch in flight, not back yet"

    await handleDriverUpdate(approachingDriver(450, 100), Date.now());

    expect(speakAsync).not.toHaveBeenCalled();
    expect(prefetchSpeedLimit).toHaveBeenCalledTimes(1);
  });

  it('does not warn when muted', async () => {
    mockCameras = [TEST_CAMERA];
    mockSpeedLimitKmh = 60;
    settingsState.masterMute = true;

    await handleDriverUpdate(approachingDriver(450, 100), Date.now());

    expect(speakAsync).not.toHaveBeenCalled();
  });

  it('fires the 500m call, then the 200m call as the driver gets closer, without ever re-firing either', async () => {
    mockCameras = [TEST_CAMERA];
    mockSpeedLimitKmh = 60;
    const now = Date.now();

    await handleDriverUpdate(approachingDriver(450, 100), now);
    expect(speakAsync).toHaveBeenCalledTimes(1);
    speakAsync.mockClear();

    await handleDriverUpdate(approachingDriver(150, 100), now + 5000);
    expect(speakAsync).toHaveBeenCalledTimes(1);
    speakAsync.mockClear();

    // Still inside 200m on a later update - already fired, must stay silent.
    await handleDriverUpdate(approachingDriver(150, 100), now + 10000);
    expect(speakAsync).not.toHaveBeenCalled();
  });

  it('retries on the next update after a TTS failure instead of permanently consuming the checkpoint', async () => {
    // Regression test: the checkpoint used to be marked fired before
    // speakAsync was even attempted, so a TTS failure (network hiccup,
    // on-device speech error) would silence this safety-critical warning
    // for the rest of the trip. It must now only be consumed on success.
    mockCameras = [TEST_CAMERA];
    mockSpeedLimitKmh = 60;
    const now = Date.now();

    speakAsync.mockRejectedValueOnce(new Error('tts failed'));
    await handleDriverUpdate(approachingDriver(450, 100), now);
    expect(speakAsync).toHaveBeenCalledTimes(1);
    speakAsync.mockClear();

    // Still within the same 500m checkpoint - since the first attempt
    // failed, this must retry rather than treat it as already fired.
    await handleDriverUpdate(approachingDriver(440, 100), now + 3000);
    expect(speakAsync).toHaveBeenCalledTimes(1);
  });

  it('speaks the report variant (not the camera variant) for a corroborated police report with no camera involved', async () => {
    mockSpeedLimitKmh = 60;
    const reportPosition = destinationPoint(MOCK_DRIVER_POSITION, 400, 180);
    const reportAlert = {
      alert_id: 'live-report-test',
      type: 'POLICE',
      subtype: null,
      reported_by: null,
      description: null,
      image: null,
      publish_datetime_utc: new Date().toISOString(),
      country: 'AU',
      city: 'Adelaide',
      street: 'Test Rd',
      latitude: reportPosition.latitude,
      longitude: reportPosition.longitude,
      num_thumbs_up: 2,
      alert_reliability: 5,
      alert_confidence: 3,
      near_by: null,
      comments: [],
      num_comments: 0,
    };
    fetchAlertsForBoundingBox.mockResolvedValue(ok([reportAlert]));

    await handleDriverUpdate({ position: destinationPoint(MOCK_DRIVER_POSITION, 480, 180), headingDeg: 0, speedKmh: 100 }, Date.now());

    expect(speakAsync).toHaveBeenCalledWith(
      expect.stringContaining('Police reported ahead'),
      expect.anything()
    );
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
    setTripStartedAtMs.mockClear();
    speakAsync.mockClear();
    stopSpeaking.mockClear();
    fetchAlertsForBoundingBox.mockReset();
    prefetchSpeedLimit.mockClear();
    mockSpeedLimitKmh = undefined;
    mockCameras = [];
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

    // selectAnnounceableAlerts's existing announcedDistances dedupe should
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
    expect(setDriverPosition).toHaveBeenCalledWith(driver.position, driver.headingDeg, driver.speedKmh);

    await jest.advanceTimersByTimeAsync(
      BRIEFING_FETCH_RETRY_INTERVAL_MS * (BRIEFING_MAX_FETCH_ATTEMPTS - 1) + 100
    );
    await promise;
  });
});
