import type { WazeAlert, WazeAlertType } from '../../api/waze/types';
import { dequeueNext, enqueue, initialAnnouncementQueueState, markSpeechFinished } from '../queue';
import { MIN_ANNOUNCEMENT_GAP_MS } from '../constants';
import type { AnnounceableAlert } from '../../engine/types';

function makeCandidate(id: string, type: WazeAlertType, distanceMeters = 500): AnnounceableAlert {
  const alert: WazeAlert = {
    alert_id: id,
    type,
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
    num_thumbs_up: 0,
    alert_reliability: 0,
    alert_confidence: 0,
    near_by: null,
    comments: [],
    num_comments: 0,
  };
  return { alert, distanceMeters, bearingDeg: 0, bearingDiffDeg: 0, ageMinutes: 0, driverHeadingDeg: 0 };
}

describe('enqueue', () => {
  it('adds new candidates and sorts the combined pending list by severity', () => {
    const state = enqueue(initialAnnouncementQueueState, [
      makeCandidate('jam', 'JAM'),
      makeCandidate('accident', 'ACCIDENT'),
    ]);
    expect(state.pending.map((c) => c.alert.alert_id)).toEqual(['accident', 'jam']);
  });

  it('does not duplicate an alert id already pending', () => {
    const first = enqueue(initialAnnouncementQueueState, [makeCandidate('police', 'POLICE')]);
    const second = enqueue(first, [makeCandidate('police', 'POLICE')]);
    expect(second.pending).toHaveLength(1);
  });

  it('refreshes an already-pending candidate with this call\'s data instead of keeping the stale one', () => {
    // A candidate can sit pending for a while (behind other speech, or the
    // MIN_ANNOUNCEMENT_GAP_MS gap) while the driver keeps closing the
    // distance - each re-submission should update it, not be ignored, or
    // both the eventually-spoken text and the recorded announced-distance
    // would reflect however far away it was when first queued.
    const first = enqueue(initialAnnouncementQueueState, [makeCandidate('police', 'POLICE', 1900)]);
    const second = enqueue(first, [makeCandidate('police', 'POLICE', 900)]);
    expect(second.pending).toHaveLength(1);
    expect(second.pending[0].distanceMeters).toBe(900);
  });

  it('leaves a pending candidate untouched when it is not resubmitted', () => {
    const first = enqueue(initialAnnouncementQueueState, [
      makeCandidate('police', 'POLICE', 1900),
      makeCandidate('jam', 'JAM', 500),
    ]);
    // Only 'jam' qualifies this time (e.g. 'police' briefly fell outside
    // the bearing/distance window) - 'police' should keep its last known data.
    const second = enqueue(first, [makeCandidate('jam', 'JAM', 300)]);
    const police = second.pending.find((c) => c.alert.alert_id === 'police');
    expect(police?.distanceMeters).toBe(1900);
  });

  it('a higher-severity alert arriving later jumps ahead of one already pending', () => {
    const first = enqueue(initialAnnouncementQueueState, [makeCandidate('jam', 'JAM')]);
    const second = enqueue(first, [makeCandidate('accident', 'ACCIDENT')]);
    expect(second.pending.map((c) => c.alert.alert_id)).toEqual(['accident', 'jam']);
  });
});

describe('dequeueNext', () => {
  it('returns null when the pending list is empty', () => {
    const { next } = dequeueNext(initialAnnouncementQueueState, 0);
    expect(next).toBeNull();
  });

  it('speaks immediately on the very first announcement (no prior lastAnnouncedAtMs)', () => {
    const state = enqueue(initialAnnouncementQueueState, [makeCandidate('police', 'POLICE')]);
    const { next } = dequeueNext(state, 0);
    expect(next?.alert.alert_id).toBe('police');
  });

  it('does not dequeue while something is already speaking', () => {
    const enqueued = enqueue(initialAnnouncementQueueState, [makeCandidate('police', 'POLICE')]);
    const { state: speakingState } = dequeueNext(enqueued, 0);
    expect(speakingState.isSpeaking).toBe(true);

    const withMore = enqueue(speakingState, [makeCandidate('jam', 'JAM')]);
    const { next } = dequeueNext(withMore, MIN_ANNOUNCEMENT_GAP_MS);
    expect(next).toBeNull();
  });

  it('withholds the next alert until the minimum gap has elapsed', () => {
    const enqueued = enqueue(initialAnnouncementQueueState, [
      makeCandidate('police', 'POLICE'),
      makeCandidate('jam', 'JAM'),
    ]);
    const { state: afterFirst } = dequeueNext(enqueued, 0);
    const afterFirstFinished = markSpeechFinished(afterFirst);

    const tooSoon = dequeueNext(afterFirstFinished, MIN_ANNOUNCEMENT_GAP_MS - 1);
    expect(tooSoon.next).toBeNull();

    const rightOnTime = dequeueNext(afterFirstFinished, MIN_ANNOUNCEMENT_GAP_MS);
    expect(rightOnTime.next?.alert.alert_id).toBe('jam');
  });

  it('removes the dequeued alert from the pending list', () => {
    const enqueued = enqueue(initialAnnouncementQueueState, [
      makeCandidate('police', 'POLICE'),
      makeCandidate('jam', 'JAM'),
    ]);
    const { state } = dequeueNext(enqueued, 0);
    expect(state.pending.map((c) => c.alert.alert_id)).toEqual(['jam']);
  });
});

describe('markSpeechFinished', () => {
  it('clears isSpeaking without touching pending or lastAnnouncedAtMs', () => {
    const enqueued = enqueue(initialAnnouncementQueueState, [makeCandidate('police', 'POLICE')]);
    const { state: speaking } = dequeueNext(enqueued, 1234);
    const finished = markSpeechFinished(speaking);

    expect(finished.isSpeaking).toBe(false);
    expect(finished.lastAnnouncedAtMs).toBe(1234);
    expect(finished.pending).toEqual(speaking.pending);
  });
});
