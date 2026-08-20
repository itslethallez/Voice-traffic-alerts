import { dequeueNext, enqueue, initialAnnouncementQueueState, markSpeechFinished } from './queue';
import { formatAnnouncement } from './formatAnnouncement';
import { speakAsync, stopSpeaking, type SpeakOptions } from './ttsAdapter';
import { delay } from './delay';
import { BRIEFING_GAP_MS } from './constants';
import type { AnnounceableAlert } from '../engine/types';
import type { AnnouncementQueueState, RecentAnnouncement } from './types';

export const MAX_RECENT_ANNOUNCEMENTS = 3;

export interface AnnouncerState {
  queue: AnnouncementQueueState;
  /**
   * Feeds back into selectAnnounceableAlerts() as announcedDistances -
   * maps an already-announced alert id to the distance it was announced
   * at, so a later call can tell "already covered" apart from "worth a
   * proximity reminder now that the driver is meaningfully closer".
   */
  announcedDistances: Map<string, number>;
  /** Most recent first, capped at MAX_RECENT_ANNOUNCEMENTS - what the Drive screen shows. */
  recent: RecentAnnouncement[];
}

export function createInitialAnnouncerState(): AnnouncerState {
  return {
    queue: initialAnnouncementQueueState,
    announcedDistances: new Map(),
    recent: [],
  };
}

/** Add newly-qualifying candidates to the pending queue. */
export function submitCandidates(
  state: AnnouncerState,
  candidates: AnnounceableAlert[]
): AnnouncerState {
  return { ...state, queue: enqueue(state.queue, candidates) };
}

export interface AnnouncerTickResult {
  state: AnnouncerState;
  spoken: RecentAnnouncement | null;
}

/**
 * Call periodically (or after each queue change / previous speech
 * completion). If it's time to speak the next pending alert - nothing
 * else speaking, and the minimum gap has elapsed - dispatches it to TTS
 * and awaits completion. A no-op (spoken: null) if it isn't time yet.
 *
 * A TTS failure never throws out of here: the queue is still unblocked
 * (isSpeaking cleared) so the next alert can be announced on the next
 * tick, matching "never crash the loop". The alert is deliberately NOT
 * added to announcedDistances/recent on failure - the driver never heard
 * it, so it shouldn't be dedupe'd as spoken or shown in the UI as if it
 * was. Since dequeueNext already removed it from the pending queue,
 * leaving it out of announcedDistances means the next
 * selectAnnounceableAlerts() call naturally reconsiders it as a fresh
 * candidate (as long as it's still otherwise eligible) rather than
 * requiring separate retry bookkeeping.
 */
export async function tick(
  state: AnnouncerState,
  nowMs: number,
  speakOptions: SpeakOptions = {}
): Promise<AnnouncerTickResult> {
  const { next, state: dequeuedQueueState } = dequeueNext(state.queue, nowMs);
  if (!next) {
    return { state, spoken: null };
  }

  const text = formatAnnouncement(next);

  let queue = dequeuedQueueState;
  let spoken: RecentAnnouncement | null = null;
  try {
    await speakAsync(text, speakOptions);
    spoken = { alertId: next.alert.alert_id, text, announcedAtMs: nowMs, candidate: next };
  } catch (error) {
    console.warn(`[speech] TTS failed for ${next.alert.alert_id}`, error);
  } finally {
    queue = markSpeechFinished(queue);
  }

  if (!spoken) {
    // dequeueNext already advanced lastAnnouncedAtMs to nowMs on the
    // assumption the alert would be spoken. It wasn't, so restore the
    // pre-dequeue gap timer - a failed attempt must not throttle the next
    // (possibly different) alert for the full MIN_ANNOUNCEMENT_GAP_MS.
    return {
      state: { ...state, queue: { ...queue, lastAnnouncedAtMs: state.queue.lastAnnouncedAtMs } },
      spoken: null,
    };
  }

  const announcedDistances = new Map(state.announcedDistances);
  announcedDistances.set(next.alert.alert_id, next.distanceMeters);
  const recent = [spoken, ...state.recent].slice(0, MAX_RECENT_ANNOUNCEMENTS);

  return { state: { queue, announcedDistances, recent }, spoken };
}

export interface SpeakBriefingOptions {
  speakOptions?: SpeakOptions;
  /** Defaults to BRIEFING_GAP_MS - overridable for tests. */
  gapMs?: number;
  signal?: AbortSignal;
  /** Called once per item, right after it's added to announcedDistances/recent. */
  onItemSpoken?: (entry: RecentAnnouncement) => void;
}

/**
 * Cold-start briefing speech. Deliberately NOT the live-driving priority
 * queue (enqueue/dequeueNext): the briefing has already been sorted
 * nearest-first by selectBriefingAlerts and must keep that exact order,
 * and paces itself with a short gap (BRIEFING_GAP_MS) rather than the
 * queue's 20s MIN_ANNOUNCEMENT_GAP_MS. Still reuses speakAsync - the same
 * TTS adapter and audio-ducking session live driving uses - and the same
 * AnnouncerState announcedDistances/recent bookkeeping tick() writes, so
 * selectAnnounceableAlerts's existing dedupe naturally skips anything
 * spoken here once live driving takes over; this never touches
 * `state.queue`, so it can't interfere with tick()'s own queue.
 *
 * An item is marked announced (added to announcedDistances/recent) only
 * once its utterance completes naturally. If `signal` aborts
 * mid-utterance, the in-flight speech is cut short via stopSpeaking()
 * rather than left to finish, and that item - along with anything after
 * it - is left off announcedDistances/recent. A thrown/rejected
 * speakAsync is treated the same way (not marked announced) but does not
 * stop the rest of the list, to match tick()'s "never crash the loop"
 * behaviour.
 */
export async function speakBriefing(
  state: AnnouncerState,
  candidates: AnnounceableAlert[],
  formatFn: (candidate: AnnounceableAlert) => string,
  options: SpeakBriefingOptions = {}
): Promise<AnnouncerState> {
  const { speakOptions = {}, gapMs = BRIEFING_GAP_MS, signal, onItemSpoken } = options;
  let current = state;

  const onAbort = () => {
    stopSpeaking().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort);

  try {
    for (let i = 0; i < candidates.length; i++) {
      if (signal?.aborted) break;

      const candidate = candidates[i];
      const text = formatFn(candidate);

      let completedNaturally = false;
      try {
        await speakAsync(text, speakOptions);
        completedNaturally = !signal?.aborted;
      } catch (error) {
        console.warn(`[speech] briefing TTS failed for ${candidate.alert.alert_id}`, error);
      }

      if (completedNaturally) {
        const entry: RecentAnnouncement = {
          alertId: candidate.alert.alert_id,
          text,
          announcedAtMs: Date.now(),
          candidate,
        };
        const announcedDistances = new Map(current.announcedDistances);
        announcedDistances.set(candidate.alert.alert_id, candidate.distanceMeters);
        current = {
          ...current,
          announcedDistances,
          recent: [entry, ...current.recent].slice(0, MAX_RECENT_ANNOUNCEMENTS),
        };
        onItemSpoken?.(entry);
      }

      if (signal?.aborted) break;
      if (i < candidates.length - 1) {
        await delay(gapMs, signal);
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  return current;
}
