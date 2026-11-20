/**
 * A forced 3-item briefing (dev/briefingFixture.ts, the same fixture the
 * drive-test build injects), proving the two briefing fixes:
 * - every item's suburb is resolved BEFORE the sentences are prefetched,
 *   and each item is spoken with exactly the prefetched sentence - even
 *   when a slow suburb lands mid-briefing;
 * - the gaps between items go through speech/nativeDelay.ts (the timer
 *   that holds with the screen off), not a JS setTimeout.
 */
let mockSuburbDelayMs: Record<string, number> = {};
const SUBURB_BY_ID: Record<string, string> = {};
jest.mock('../../config/env', () => ({ env: { mapboxAccessToken: 'test-token', backendApiBaseUrl: '' } }));
jest.mock('../../config/featureFlags', () => ({
  ...jest.requireActual('../../config/featureFlags'),
  BRIEFING_FIXTURE_ENABLED: true,
}));
const suburbLookups: string[] = [];
jest.mock('../../api/mapbox/reverseGeocode', () => ({
  fetchSuburbForPoint: (point: { latitude: number; longitude: number }) => {
    const key = `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`;
    suburbLookups.push(key);
    return new Promise((resolve) => setTimeout(() => resolve(SUBURB_BY_ID[key] ?? null), mockSuburbDelayMs[key] ?? 300));
  },
}));

const spoken: string[] = [];
const prefetched: string[][] = [];
const events: string[] = [];
jest.mock('../../speech/ttsAdapter', () => ({
  speakAsync: async (text: string) => {
    events.push(`speak:${text}`);
    spoken.push(text);
  },
  speakUrgentAsync: async () => {},
  prefetchSpeech: (texts: string[]) => {
    events.push(`prefetch:${texts.length}`);
    prefetched.push([...texts]);
  },
  warmUpDeviceVoice: () => Promise.resolve(),
  stopSpeaking: () => Promise.resolve(),
}));
const nativeDelays: number[] = [];
jest.mock('../../speech/nativeDelay', () => ({
  nativeDelay: (ms: number, signal?: AbortSignal) => {
    nativeDelays.push(ms);
    return jest.requireActual('../../speech/delay').delay(ms, signal);
  },
}));
jest.mock('../../speech/googleTts', () => ({ checkGoogleTtsWatchdog: () => {} }));
jest.mock('../../api/waze/fetchAlertsForBoundingBox', () => ({
  fetchAlertsForBoundingBox: () => Promise.resolve({ alerts: [], quadrantRateLimited: false }),
}));
jest.mock('../../api/backend/client', () => ({
  fetchFixedCameras: () => Promise.reject(new Error('not in this test')),
  fetchOwnReports: () => Promise.resolve([]),
  fetchNearbyReports: () => Promise.resolve([]),
  fetchCorridorAlerts: () => Promise.resolve([]),
}));
jest.mock('../../config/deviceId', () => ({ getDeviceId: () => Promise.resolve('test-device') }));
jest.mock('../../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => jest.requireActual('../../store/settingsDefaults').defaultSettingsValues },
}));
const pushAnnouncement = jest.fn();
jest.mock('../../store/useTripStore', () => ({
  useTripStore: {
    getState: () => ({
      pushAnnouncement,
      setOffline: () => {},
      setBannerMessage: () => {},
      setDriverPosition: () => {},
      setVisibleAlerts: () => {},
      setAlertsFetchedAtMs: () => {},
      setFixedCameras: () => {},
      setTripStartedAtMs: () => {},
      setManualReports: () => {},
      setNearbyReports: () => {},
      bannerMessage: null,
    }),
  },
}));

import { briefingFixtureAlerts } from '../../dev/briefingFixture';
import type { DriverState } from '../../engine/types';
import { BRIEFING_GAP_MS } from '../../speech/constants';
import { resetTripRuntime, runBriefing } from '../tripRuntime';

/** Adelaide Airport - where the emulator drive test starts. */
const START = { latitude: -34.943374, longitude: 138.531233 };
const driver: DriverState = { position: START, headingDeg: 0, speedKmh: 0 };
const NAMES = ['West Beach', 'Netley', 'Glenelg North'];
/** A second start point, so the suburb cache (module-level, kept for the
 * whole app session by design) holds nothing for it yet. */
const ELSEWHERE = { latitude: -34.85, longitude: 138.6 };

function keyOf(i: number, origin = START): string {
  const a = briefingFixtureAlerts(origin, Date.now())[i];
  return `${a.latitude.toFixed(4)},${a.longitude.toFixed(4)}`;
}

beforeEach(() => {
  jest.useFakeTimers();
  resetTripRuntime();
  spoken.length = 0;
  prefetched.length = 0;
  events.length = 0;
  nativeDelays.length = 0;
  suburbLookups.length = 0;
  mockSuburbDelayMs = {};
  NAMES.forEach((name, i) => {
    SUBURB_BY_ID[keyOf(i)] = name;
    SUBURB_BY_ID[keyOf(i, ELSEWHERE)] = name;
  });
});
afterEach(() => jest.useRealTimers());

async function brief(from: DriverState = driver): Promise<void> {
  const done = runBriefing(from, Date.now());
  await jest.advanceTimersByTimeAsync(20_000);
  await done;
}

describe('forced 3-item briefing (drive-test fixture)', () => {
  it('resolves every suburb before prefetching, and speaks exactly the prefetched sentences', async () => {
    await brief();
    const items = prefetched.find((batch) => batch.length === 3);
    expect(items).toBeDefined();
    // Each sentence names its resolved suburb - not the empty Waze city.
    for (const name of NAMES) expect(items!.some((t) => t.includes(`in ${name}`))).toBe(true);
    expect(spoken).toEqual(items);
    // Prefetch came after all three lookups landed, before the first item.
    expect(events.indexOf('prefetch:3')).toBeLessThan(events.findIndex((e) => e.startsWith('speak:')));
  });

  it('puts the 1.5s gaps between items through nativeDelay - the screen-off-safe timer', async () => {
    await brief();
    // The suburb wait (1.5s, also native), then one gap between each item.
    expect(nativeDelays).toEqual([1_500, BRIEFING_GAP_MS, BRIEFING_GAP_MS]);
  });

  it('a suburb that lands after the 1.5s wait does not change what is spoken from what was prefetched', async () => {
    mockSuburbDelayMs[keyOf(1, ELSEWHERE)] = 4_000; // lands during the briefing
    await brief({ ...driver, position: ELSEWHERE });
    const items = prefetched.find((batch) => batch.length === 3)!;
    expect(items.some((t) => t.includes('Netley'))).toBe(false); // not resolved in time
    expect(spoken).toEqual(items); // ...and still spoken exactly as prefetched
  });
});
