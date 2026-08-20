import type { WazeAlert, WazeAlertType } from '../../api/waze/types';
import type { AnnounceableAlert } from '../../engine/types';

const speakAsync = jest.fn<Promise<void>, [string, Record<string, unknown>?]>();
const stopSpeaking = jest.fn<Promise<void>, []>();

jest.mock('../ttsAdapter', () => ({
  speakAsync: (...args: [string, Record<string, unknown>?]) => speakAsync(...args),
  stopSpeaking: () => stopSpeaking(),
}));

const delayMock = jest.fn<Promise<void>, [number, AbortSignal?]>();

jest.mock('../delay', () => ({
  delay: (...args: [number, AbortSignal?]) => delayMock(...args),
}));

import { createInitialAnnouncerState, speakBriefing, submitCandidates, tick } from '../announcer';
import { BRIEFING_GAP_MS, MIN_ANNOUNCEMENT_GAP_MS } from '../constants';
import { formatBriefingAlert } from '../formatAnnouncement';

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
  return { alert, distanceMeters, bearingDeg: 0, bearingDiffDeg: 0, ageMinutes: 3, driverHeadingDeg: 0 };
}

describe('announcer', () => {
  beforeEach(() => {
    speakAsync.mockReset();
    speakAsync.mockResolvedValue(undefined);
    stopSpeaking.mockReset();
    stopSpeaking.mockResolvedValue(undefined);
    delayMock.mockReset();
    delayMock.mockResolvedValue(undefined);
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
    expect(result.state.announcedDistances.get('accident')).toBe(500); // makeCandidate's default distanceMeters
    expect(result.state.recent[0].alertId).toBe('accident');
    expect(result.state.queue.isSpeaking).toBe(false);
  });

  it('records the distance an alert was announced at, for the proximity-reminder dedupe', async () => {
    let state = createInitialAnnouncerState();
    state = submitCandidates(state, [makeCandidate('a', 'POLICE', 1800)]);

    const result = await tick(state, 0);

    expect(result.state.announcedDistances.get('a')).toBe(1800);
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

  it('unblocks the queue even when TTS fails, without throwing, and does not mark the alert as spoken', async () => {
    speakAsync.mockRejectedValueOnce(new Error('tts failed'));
    let state = createInitialAnnouncerState();
    state = submitCandidates(state, [makeCandidate('a', 'POLICE')]);

    const result = await tick(state, 0);

    // The driver never heard it - not reported as spoken, not dedupe'd.
    expect(result.spoken).toBeNull();
    expect(result.state.announcedDistances.has('a')).toBe(false);
    expect(result.state.recent).toEqual([]);
    expect(result.state.queue.isSpeaking).toBe(false);
  });

  it('does not advance the announcement gap timer on a TTS failure, so a fresh alert is not throttled', async () => {
    speakAsync.mockRejectedValueOnce(new Error('tts failed'));
    let state = createInitialAnnouncerState();
    state = submitCandidates(state, [makeCandidate('a', 'POLICE')]);

    const now = 10_000;
    const failed = await tick(state, now);
    expect(failed.spoken).toBeNull();

    // Immediately retry with a different candidate. dequeueNext had
    // already advanced lastAnnouncedAtMs to `now` on the assumption 'a'
    // would be spoken - if that wasn't restored on failure, this would be
    // wrongly throttled for the full MIN_ANNOUNCEMENT_GAP_MS even though
    // nothing was actually announced.
    const retryState = submitCandidates(failed.state, [makeCandidate('b', 'JAM')]);
    const retry = await tick(retryState, now + 1);
    expect(retry.spoken?.alertId).toBe('b');
  });
});

describe('speakBriefing', () => {
  beforeEach(() => {
    speakAsync.mockReset();
    speakAsync.mockResolvedValue(undefined);
    stopSpeaking.mockReset();
    stopSpeaking.mockResolvedValue(undefined);
    delayMock.mockReset();
    delayMock.mockResolvedValue(undefined);
  });

  it('speaks candidates in the given order, not resorted by severity', async () => {
    const state = createInitialAnnouncerState();
    // Deliberately POLICE-then-ACCIDENT: severity would flip this order,
    // nearest-first (already applied by the caller) should not be touched.
    const candidates = [makeCandidate('near', 'POLICE'), makeCandidate('far', 'ACCIDENT')];

    await speakBriefing(state, candidates, formatBriefingAlert);

    expect(speakAsync.mock.calls[0][0]).toContain('Police');
    expect(speakAsync.mock.calls[1][0]).toContain('Crash');
  });

  it('waits for each utterance to complete before starting the gap, and uses BRIEFING_GAP_MS by default', async () => {
    const callOrder: string[] = [];
    speakAsync.mockImplementation(async () => {
      callOrder.push('speak');
    });
    delayMock.mockImplementation(async () => {
      callOrder.push('gap');
    });

    const state = createInitialAnnouncerState();
    const candidates = [makeCandidate('a', 'POLICE'), makeCandidate('b', 'JAM')];

    await speakBriefing(state, candidates, formatBriefingAlert);

    expect(callOrder).toEqual(['speak', 'gap', 'speak']); // no trailing gap after the last item
    expect(delayMock).toHaveBeenCalledWith(BRIEFING_GAP_MS, undefined);
  });

  it('does not gap after the final item', async () => {
    const state = createInitialAnnouncerState();
    await speakBriefing(state, [makeCandidate('a', 'POLICE')], formatBriefingAlert);
    expect(delayMock).not.toHaveBeenCalled();
  });

  it('marks each successfully spoken alert as announced, for later live-driving dedupe', async () => {
    const state = createInitialAnnouncerState();
    const candidates = [makeCandidate('a', 'POLICE'), makeCandidate('b', 'JAM')];

    const result = await speakBriefing(state, candidates, formatBriefingAlert);

    expect(result.announcedDistances.has('a')).toBe(true);
    expect(result.announcedDistances.has('b')).toBe(true);
    expect(result.recent.map((r) => r.alertId)).toEqual(['b', 'a']);
  });

  it('does not touch the live-driving queue', async () => {
    const state = createInitialAnnouncerState();
    const result = await speakBriefing(state, [makeCandidate('a', 'POLICE')], formatBriefingAlert);
    expect(result.queue).toBe(state.queue);
  });

  it('reports each item via onItemSpoken as it is spoken', async () => {
    const onItemSpoken = jest.fn();
    const state = createInitialAnnouncerState();
    const candidates = [makeCandidate('a', 'POLICE'), makeCandidate('b', 'JAM')];

    await speakBriefing(state, candidates, formatBriefingAlert, { onItemSpoken });

    expect(onItemSpoken).toHaveBeenCalledTimes(2);
    expect(onItemSpoken.mock.calls[0][0].alertId).toBe('a');
    expect(onItemSpoken.mock.calls[1][0].alertId).toBe('b');
  });

  it('does not mark an alert announced when TTS fails, but continues to the rest of the list', async () => {
    speakAsync.mockRejectedValueOnce(new Error('tts failed'));
    const state = createInitialAnnouncerState();
    const candidates = [makeCandidate('a', 'POLICE'), makeCandidate('b', 'JAM')];

    const result = await speakBriefing(state, candidates, formatBriefingAlert);

    expect(result.announcedDistances.has('a')).toBe(false);
    expect(result.announcedDistances.has('b')).toBe(true);
  });

  it('stops speaking and marks nothing further once the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const state = createInitialAnnouncerState();
    const candidates = [makeCandidate('a', 'POLICE'), makeCandidate('b', 'JAM')];

    const result = await speakBriefing(state, candidates, formatBriefingAlert, {
      signal: controller.signal,
    });

    expect(speakAsync).not.toHaveBeenCalled();
    expect(result.announcedDistances.size).toBe(0);
  });

  it('cuts off mid-utterance via stopSpeaking when cancelled, and does not mark that item announced', async () => {
    const controller = new AbortController();
    // speakAsync "completes" (as it would once Speech.stop() fires
    // onStopped) right as the abort happens.
    speakAsync.mockImplementation(async () => {
      controller.abort();
    });

    const state = createInitialAnnouncerState();
    const candidates = [makeCandidate('a', 'POLICE'), makeCandidate('b', 'JAM')];

    const result = await speakBriefing(state, candidates, formatBriefingAlert, {
      signal: controller.signal,
    });

    expect(stopSpeaking).toHaveBeenCalled();
    expect(result.announcedDistances.has('a')).toBe(false);
    expect(result.announcedDistances.has('b')).toBe(false); // loop stopped, never reached
    expect(speakAsync).toHaveBeenCalledTimes(1); // did not proceed to 'b'
  });

  it('is a no-op for an empty candidate list', async () => {
    const state = createInitialAnnouncerState();
    const result = await speakBriefing(state, [], formatBriefingAlert);
    expect(result).toBe(state);
    expect(speakAsync).not.toHaveBeenCalled();
  });
});
