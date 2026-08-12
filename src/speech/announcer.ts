import { dequeueNext, enqueue, initialAnnouncementQueueState, markSpeechFinished } from './queue';
import { formatAnnouncement } from './formatAnnouncement';
import { speakAsync, type SpeakOptions } from './ttsAdapter';
import type { AnnounceableAlert } from '../engine/types';
import type { AnnouncementQueueState, RecentAnnouncement } from './types';

export const MAX_RECENT_ANNOUNCEMENTS = 3;

export interface AnnouncerState {
  queue: AnnouncementQueueState;
  /** Dedupe set to feed back into selectAnnounceableAlerts() as alreadyAnnouncedIds. */
  announcedIds: Set<string>;
  /** Most recent first, capped at MAX_RECENT_ANNOUNCEMENTS - what the Drive screen shows. */
  recent: RecentAnnouncement[];
}

export function createInitialAnnouncerState(): AnnouncerState {
  return {
    queue: initialAnnouncementQueueState,
    announcedIds: new Set(),
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
 * tick, matching "never crash the loop".
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
  const recentEntry: RecentAnnouncement = {
    alertId: next.alert.alert_id,
    text,
    announcedAtMs: nowMs,
  };

  const announcedIds = new Set(state.announcedIds);
  announcedIds.add(next.alert.alert_id);
  const recent = [recentEntry, ...state.recent].slice(0, MAX_RECENT_ANNOUNCEMENTS);

  let queue = dequeuedQueueState;
  try {
    await speakAsync(text, speakOptions);
  } catch (error) {
    console.warn(`[speech] TTS failed for ${next.alert.alert_id}`, error);
  } finally {
    queue = markSpeechFinished(queue);
  }

  return { state: { queue, announcedIds, recent }, spoken: recentEntry };
}
