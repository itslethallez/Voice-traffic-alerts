import type { WazeAlert, WazeAlertType } from '../../api/waze/types';
import type { AnnounceableAlert } from '../../engine/types';

const speakAsync = jest.fn<Promise<void>, [string, Record<string, unknown>?]>();

jest.mock('../ttsAdapter', () => ({
  speakAsync: (...args: [string, Record<string, unknown>?]) => speakAsync(...args),
}));

import { createInitialAnnouncerState, submitCandidates, tick } from '../announcer';
import { MIN_ANNOUNCEMENT_GAP_MS } from '../constants';

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
  return { alert, distanceMeters, bearingDeg: 0, bearingDiffDeg: 0, ageMinutes: 3 };
}

describe('announcer', () => {
  beforeEach(() => {
    speakAsync.mockReset();
    speakAsync.mockResolvedValue(undefined);
  });

  it('is a no-op when nothing is pending', async () => {
    const state = createInitialAnnouncerState();
    const result = await tick(state, 0);
    expect(result.spoken).toBeNull();
    expect(speakAsync).not.toHaveBeenCalled();
  });

  it('speaks the highest-severity pending alert and records it as announced', async () => {
    let state = createInitialAnnouncerState();
    state = submitCandidates(state, [
      makeCandidate('jam', 'JAM'),
      makeCandidate('accident', 'ACCIDENT'),
    ]);

    const result = await tick(state, 0);

    expect(speakAsync).toHaveBeenCalledTimes(1);
    expect(result.spoken?.alertId).toBe('accident');
    expect(result.state.announcedIds.has('accident')).toBe(true);
    expect(result.state.recent[0].alertId).toBe('accident');
    expect(result.state.queue.isSpeaking).toBe(false);
  });

  it('withholds the next announcement until the minimum gap has elapsed', async () => {
    let state = createInitialAnnouncerState();
    state = submitCandidates(state, [makeCandidate('a', 'POLICE'), makeCandidate('b', 'JAM')]);

    const first = await tick(state, 0);
    const tooSoon = await tick(first.state, MIN_ANNOUNCEMENT_GAP_MS - 1);
    expect(tooSoon.spoken).toBeNull();
    expect(speakAsync).toHaveBeenCalledTimes(1);

    const onTime = await tick(first.state, MIN_ANNOUNCEMENT_GAP_MS);
    expect(onTime.spoken?.alertId).toBe('b');
  });

  it('caps recent announcements at 3, most recent first', async () => {
    let state = createInitialAnnouncerState();
    let now = 0;
    for (const id of ['a', 'b', 'c', 'd']) {
      state = submitCandidates(state, [makeCandidate(id, 'POLICE')]);
      const result = await tick(state, now);
      state = result.state;
      now += MIN_ANNOUNCEMENT_GAP_MS;
    }

    expect(state.recent.map((r) => r.alertId)).toEqual(['d', 'c', 'b']);
  });

  it('unblocks the queue even when TTS fails, without throwing', async () => {
    speakAsync.mockRejectedValueOnce(new Error('tts failed'));
    let state = createInitialAnnouncerState();
    state = submitCandidates(state, [makeCandidate('a', 'POLICE')]);

    const result = await tick(state, 0);

    expect(result.spoken?.alertId).toBe('a');
    expect(result.state.queue.isSpeaking).toBe(false);
  });
});
