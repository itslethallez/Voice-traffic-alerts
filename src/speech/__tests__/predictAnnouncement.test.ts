// Stand-in for the real sentence: same 100m rounding (formatDistance), so
// what's under test is the predicted distance/age per alert, not the wording.
jest.mock('../formatAnnouncement', () => ({
  formatAnnouncement: (c: { alert: { alert_id: string }; distanceMeters: number; ageMinutes: number }) =>
    `${c.alert.alert_id} ${Math.round(c.distanceMeters / 100) * 100}m age${Math.floor(c.ageMinutes)}`,
}));

import type { AnnounceableAlert, ApproachingAlert, DriverState } from '../../engine/types';
import { MIN_ANNOUNCEMENT_GAP_MS } from '../constants';
import { MAX_PREFETCH_TEXTS, PREFETCH_HORIZON_MS, predictUpcomingAnnouncementTexts } from '../predictAnnouncement';
import type { AnnouncementQueueState } from '../types';

const T0 = 1_000_000;

function candidate(distanceMeters: number, ageMinutes = 2, id = 'a'): AnnounceableAlert {
  return {
    alert: { alert_id: id } as AnnounceableAlert['alert'],
    distanceMeters,
    bearingDeg: 0,
    bearingDiffDeg: 0,
    ageMinutes,
    driverHeadingDeg: 0,
  };
}

function queue(pending: AnnounceableAlert[], lastAnnouncedAtMs: number | null): AnnouncementQueueState {
  return { pending, isSpeaking: false, lastAnnouncedAtMs };
}

function approaching(distanceMeters: number, entryDistanceMeters: number, id: string): ApproachingAlert {
  return { candidate: candidate(distanceMeters, 2, id), entryDistanceMeters };
}

/** 72 km/h = exactly 20 m/s, so the arithmetic below is readable. */
const driver: DriverState = { position: { latitude: 0, longitude: 0 }, headingDeg: 0, speedKmh: 72 };
const predict = (q: AnnouncementQueueState, a: ApproachingAlert[] = [], measured = T0, now = T0, d = driver) =>
  predictUpcomingAnnouncementTexts(q, a, d, measured, now);

describe('predictUpcomingAnnouncementTexts - the queue', () => {
  it('returns nothing with an empty queue and nothing approaching', () => {
    expect(predict(queue([], null))).toEqual([]);
  });

  it('returns nothing while something is speaking', () => {
    expect(predict({ ...queue([candidate(3000)], null), isSpeaking: true })).toEqual([]);
  });

  it('predicts the head at gap expiry and one driver-update later', () => {
    // Gap ends 8s from now: 3000 - 20m/s * 8s = 2840 -> "2800m";
    // 3s later 2780 -> "2800m" too, so one sentence.
    const q = queue([candidate(3000)], T0 - MIN_ANNOUNCEMENT_GAP_MS + 8_000);
    expect(predict(q)).toEqual(['a 2800m age2']);
  });

  it('returns both sentences when the update window straddles a 100m rounding boundary', () => {
    // 5s out: 2900 -> "2900m"; 8s out: 2840 -> "2800m".
    const q = queue([candidate(3000)], T0 - MIN_ANNOUNCEMENT_GAP_MS + 5_000);
    expect(predict(q)).toEqual(['a 2900m age2', 'a 2800m age2']);
  });

  it('predicts every pending item at its own 20s slot, not just the head', () => {
    // Head at 0s/3s, second at 20s/23s (400/460m closed), third at 40s/43s (800/860m).
    const q = queue([candidate(3000, 2, 'a'), candidate(4000, 2, 'b'), candidate(4500, 2, 'c')], null);
    expect(predict(q)).toEqual([
      'a 3000m age2',
      'a 2900m age2',
      'b 3600m age2',
      'b 3500m age2',
      'c 3700m age2',
      'c 3600m age2',
    ]);
  });

  it('stops at the horizon', () => {
    const many = ['a', 'b', 'c', 'd'].map((id) => candidate(4000, 2, id));
    // Slots 0s, 20s, 40s fit within 45s; the 60s slot doesn't.
    expect(predict(queue(many, null)).some((t) => t.startsWith('d '))).toBe(false);
    expect(PREFETCH_HORIZON_MS).toBeLessThan(3 * MIN_ANNOUNCEMENT_GAP_MS);
  });

  it('counts the time tick() spent speaking since the distance was measured', () => {
    const q = queue([candidate(3000)], T0 - MIN_ANNOUNCEMENT_GAP_MS);
    expect(predict(q, [], T0, T0 + 6_000)).toEqual(['a 2900m age2', 'a 2800m age2']);
  });

  it('advances the age too, so a "reported n minutes ago" suffix matches', () => {
    // 3s and 6s since measurement: 10.95 + 0.05 = 11.0, + 0.1 = 11.05.
    expect(predict(queue([candidate(3000, 10.95)], null), [], T0, T0 + 3_000)).toEqual(['a 2900m age11']);
  });

  it('never predicts a negative distance', () => {
    expect(predict(queue([candidate(10)], null))).toEqual(['a 0m age2']); // 10m, then -50m clamped to 0
  });

  it('a stationary driver predicts the current sentence', () => {
    expect(predict(queue([candidate(3000)], null), [], T0, T0, { ...driver, speedKmh: 0 })).toEqual(['a 3000m age2']);
  });
});

describe('predictUpcomingAnnouncementTexts - alerts approaching the warn radius', () => {
  it('predicts the entry sentence for an alert outside the radius, with an empty queue', () => {
    // 5400m, radius 5000m: enters in 20s at exactly 5000m; the pass that
    // catches it lands within 3s, at up to 60m inside.
    expect(predict(queue([], null), [approaching(5400, 5000, 'x')])).toEqual(['x 5000m age2', 'x 4900m age2']);
  });

  it('the entry sentence is the same on every update while it approaches - one fetch, not one per update', () => {
    const a = predict(queue([], null), [approaching(5400, 5000, 'x')], T0, T0);
    const b = predict(queue([], null), [approaching(5340, 5000, 'x')], T0 + 3_000, T0 + 3_000);
    expect(b).toEqual(a);
  });

  it('pushes an approaching alert behind the queue when its entry falls inside a busy slot', () => {
    // Pending 'a' takes the 0s slot; 'x' enters at 2s but can't be spoken
    // until the 20s slot: 5040 - 400 = 4640 and 5040 - 460 = 4580, both "4600m".
    const texts = predict(queue([candidate(3000, 2, 'a')], null), [approaching(5040, 5000, 'x')]);
    expect(texts.filter((t) => t.startsWith('x '))).toEqual(['x 4600m age2']);
  });

  it('orders approaching alerts by when they cross in', () => {
    const texts = predict(queue([], null), [approaching(5800, 5000, 'late'), approaching(5100, 5000, 'soon')]);
    expect(texts[0]).toBe('soon 5000m age2');
  });

  it('ignores an alert whose entry is beyond the horizon', () => {
    // 1200m out at 20 m/s = 60s away.
    expect(predict(queue([], null), [approaching(6200, 5000, 'far')])).toEqual([]);
  });

  it('predicts nothing approaching for a stationary driver', () => {
    expect(predict(queue([], null), [approaching(5100, 5000, 'x')], T0, T0, { ...driver, speedKmh: 0 })).toEqual([]);
  });

  it('caps the number of sentences per call', () => {
    const many = Array.from({ length: 12 }, (_, i) => approaching(5005 + i * 10, 5000, `x${i}`));
    expect(predict(queue([], null), many).length).toBeLessThanOrEqual(MAX_PREFETCH_TEXTS);
  });
});
