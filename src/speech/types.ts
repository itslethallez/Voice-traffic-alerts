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
  /** The full candidate this was spoken from - street/city/type/distance/
   * driverHeadingDeg all live on it already. Lets the radar UI's Nearby
   * Transmission card show real structured detail (street, suburb,
   * direction, distance, confidence) without formatAnnouncement's spoken
   * sentence needing to double as a UI data model. */
  candidate: AnnounceableAlert;
}
