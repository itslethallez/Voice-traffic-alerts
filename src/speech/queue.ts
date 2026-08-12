import { sortBySeverity } from '../engine/severity';
import type { AnnounceableAlert } from '../engine/types';
import { MIN_ANNOUNCEMENT_GAP_MS } from './constants';
import type { AnnouncementQueueState } from './types';

export const initialAnnouncementQueueState: AnnouncementQueueState = {
  pending: [],
  isSpeaking: false,
  lastAnnouncedAtMs: null,
};

/**
 * Merges newly-qualifying candidates into the pending list (skipping ones
 * already pending) and re-sorts by severity, so a higher-priority alert
 * that shows up mid-queue jumps ahead of lower-priority ones still
 * waiting.
 */
export function enqueue(
  state: AnnouncementQueueState,
  candidates: AnnounceableAlert[]
): AnnouncementQueueState {
  const pendingIds = new Set(state.pending.map((c) => c.alert.alert_id));
  const newOnes = candidates.filter((c) => !pendingIds.has(c.alert.alert_id));
  if (newOnes.length === 0) return state;

  return { ...state, pending: sortBySeverity([...state.pending, ...newOnes]) };
}

export interface DequeueResult {
  next: AnnounceableAlert | null;
  state: AnnouncementQueueState;
}

/**
 * Pure decision: is it time to speak the next pending alert? No, if
 * something is already speaking, nothing is pending, or the minimum gap
 * since the last announcement hasn't elapsed yet. The caller is
 * responsible for actually invoking TTS with the returned alert and
 * later calling markSpeechFinished().
 */
export function dequeueNext(state: AnnouncementQueueState, nowMs: number): DequeueResult {
  if (state.isSpeaking || state.pending.length === 0) {
    return { next: null, state };
  }
  if (state.lastAnnouncedAtMs !== null && nowMs - state.lastAnnouncedAtMs < MIN_ANNOUNCEMENT_GAP_MS) {
    return { next: null, state };
  }

  const [next, ...rest] = state.pending;
  return {
    next,
    state: { pending: rest, isSpeaking: true, lastAnnouncedAtMs: nowMs },
  };
}

export function markSpeechFinished(state: AnnouncementQueueState): AnnouncementQueueState {
  return { ...state, isSpeaking: false };
}
