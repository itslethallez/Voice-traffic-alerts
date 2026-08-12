import type { AnnounceableAlert } from '../engine/types';

export interface AnnouncementQueueState {
  pending: AnnounceableAlert[];
  isSpeaking: boolean;
  /** ms epoch when the last announcement was dispatched to speech. */
  lastAnnouncedAtMs: number | null;
}

export interface RecentAnnouncement {
  alertId: string;
  text: string;
  announcedAtMs: number;
}
