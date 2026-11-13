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
 * Merges newly-qualifying candidates into the pending list and re-sorts by
 * severity, so a higher-priority alert that shows up mid-queue jumps ahead
 * of lower-priority ones still waiting.
 *
 * An id already pending is refreshed in place (distance/bearing/age
 * replaced with this call's values) rather than left untouched - an alert
 * can sit pending for a while (behind something else speaking, or the
 * MIN_ANNOUNCEMENT_GAP_MS gap), and selectAnnounceableAlerts() keeps
 * re-offering it on every driver update for as long as it's still
 * eligible, each time with a distance closer to reality than the last.
 * Without this, the eventually-spoken text (formatAnnouncement reads
 * distanceMeters directly) and the distance recorded as "announced at"
 * would both be however far away the alert was when it first joined the
 * queue, not when the driver actually heard it.
 */
export function enqueue(
  state: AnnouncementQueueState,
  candidates: AnnounceableAlert[]
): AnnouncementQueueState {
  if (candidates.length === 0) return state;

  const pendingIds = new Set(state.pending.map((c) => c.alert.alert_id));
  const candidateById = new Map(candidates.map((c) => [c.alert.alert_id, c]));

  const refreshedPending = state.pending.map((c) => candidateById.get(c.alert.alert_id) ?? c);
  const newOnes = candidates.filter((c) => !pendingIds.has(c.alert.alert_id));

  return { ...state, pending: sortBySeverity([...refreshedPending, ...newOnes]) };
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
