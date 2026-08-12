import type { WazeAlert } from '../../api/waze/types';
import { applyFetchResult, initialAlertsCache } from '../cache';

const SAMPLE_ALERT: WazeAlert = {
  alert_id: 'wm-001',
  type: 'POLICE',
  subtype: null,
  reported_by: null,
  description: null,
  image: null,
  publish_datetime_utc: '2026-01-01T00:00:00.000Z',
  country: 'AU',
  city: 'Adelaide',
  street: 'North Terrace',
  latitude: -34.9,
  longitude: 138.6,
  num_thumbs_up: 1,
  alert_reliability: 5,
  alert_confidence: 2,
  near_by: null,
  comments: [],
  num_comments: 0,
};

describe('applyFetchResult', () => {
  it('stores a successful fetch and clears the stale flag', () => {
    const next = applyFetchResult(initialAlertsCache, { ok: true, alerts: [SAMPLE_ALERT], nowMs: 1000 });
    expect(next.alerts).toEqual([SAMPLE_ALERT]);
    expect(next.fetchedAtMs).toBe(1000);
    expect(next.isStale).toBe(false);
  });

  it('keeps serving the previous alerts on a failed fetch, marked stale', () => {
    const afterSuccess = applyFetchResult(initialAlertsCache, {
      ok: true,
      alerts: [SAMPLE_ALERT],
      nowMs: 1000,
    });
    const afterFailure = applyFetchResult(afterSuccess, { ok: false });

    expect(afterFailure.alerts).toEqual([SAMPLE_ALERT]);
    expect(afterFailure.fetchedAtMs).toBe(1000);
    expect(afterFailure.isStale).toBe(true);
  });

  it('a failed fetch with an empty cache does not throw and leaves an empty list', () => {
    expect(() => applyFetchResult(initialAlertsCache, { ok: false })).not.toThrow();
    const next = applyFetchResult(initialAlertsCache, { ok: false });
    expect(next.alerts).toEqual([]);
    expect(next.isStale).toBe(true);
  });
});
