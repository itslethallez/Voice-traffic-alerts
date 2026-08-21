import { create } from 'zustand';
import type { WazeAlert } from '../api/waze/types';
import type { GeoPoint } from '../geo/types';
import type { RecentAnnouncement } from '../speech/types';

export type TripStatus = 'listening' | 'muted' | 'offline';

const MAX_RECENT_ANNOUNCEMENTS = 3;

/**
 * A driver-initiated "Report what you see" (Step 11b's hold-to-confirm
 * dial) - local-only. There is no Waze write API in this integration (the
 * Waze client here only ever reads alerts-and-jams), so this cannot be
 * submitted anywhere; it just becomes a local trip record the driver can
 * see in History, the same way a spoken announcement does.
 */
/** A tap-and-talk recording attached to a ManualReport (Step 12 #26) -
 * record-only, no transcription. `uri` is playable directly via expo-audio's
 * useAudioPlayer, the same way NearbyTransmissionCard replays a live
 * announcement. */
export interface VoiceNote {
  uri: string;
  durationMs: number;
}

export interface ManualReport {
  id: string;
  createdAtMs: number;
  position: GeoPoint | null;
  voiceNote: VoiceNote | null;
}

/**
 * Ephemeral trip state - resets on relaunch. Master mute lives in
 * useSettingsStore.ts instead (Step 7): it's a persisted preference, not
 * trip state, and the Drive screen's mute button and the Settings
 * screen's master mute switch both read/write that single source of
 * truth so they can't drift out of sync with each other.
 */
interface TripStoreState {
  isOffline: boolean;
  /** Small one-line banner slot - the rate-limit notice (Step 9) or the
   * background-location-off notice (Step 8) share this single slot,
   * since only one is likely to be relevant at a time and the spec asks
   * for "a small banner", not a stack of them. */
  bannerMessage: string | null;
  locationError: string | null;
  recentAnnouncements: RecentAnnouncement[];
  /**
   * Read-only mirror of trip/tripRuntime.ts's module-level driver
   * position/heading and alerts cache (Step 11) - purely for the radar
   * UI to render from. tripRuntime.ts writes these alongside its own
   * bookkeeping; nothing reads them back to make filtering/speech
   * decisions, so this can't feed back into or change that logic.
   */
  driverPosition: GeoPoint | null;
  driverHeadingDeg: number;
  visibleAlerts: WazeAlert[];
  manualReports: ManualReport[];
  pushAnnouncement: (announcement: RecentAnnouncement) => void;
  pushManualReport: (voiceNote?: VoiceNote) => void;
  setOffline: (offline: boolean) => void;
  setBannerMessage: (message: string | null) => void;
  setLocationError: (message: string | null) => void;
  setDriverPosition: (position: GeoPoint, headingDeg: number) => void;
  setVisibleAlerts: (alerts: WazeAlert[]) => void;
}

export const useTripStore = create<TripStoreState>((set, get) => ({
  isOffline: false,
  bannerMessage: null,
  locationError: null,
  recentAnnouncements: [],
  driverPosition: null,
  driverHeadingDeg: 0,
  visibleAlerts: [],
  manualReports: [],
  pushAnnouncement: (announcement) =>
    set((state) => ({
      recentAnnouncements: [announcement, ...state.recentAnnouncements].slice(
        0,
        MAX_RECENT_ANNOUNCEMENTS
      ),
    })),
  pushManualReport: (voiceNote) =>
    set((state) => ({
      manualReports: [
        {
          id: `manual-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          createdAtMs: Date.now(),
          position: get().driverPosition,
          voiceNote: voiceNote ?? null,
        },
        ...state.manualReports,
      ],
    })),
  setOffline: (offline) => set({ isOffline: offline }),
  setBannerMessage: (message) => set({ bannerMessage: message }),
  setLocationError: (message) => set({ locationError: message }),
  setDriverPosition: (position, headingDeg) =>
    set({ driverPosition: position, driverHeadingDeg: headingDeg }),
  setVisibleAlerts: (alerts) => set({ visibleAlerts: alerts }),
}));

export function statusFor(state: { masterMute: boolean; isOffline: boolean }): TripStatus {
  if (state.masterMute) return 'muted';
  if (state.isOffline) return 'offline';
  return 'listening';
}

export function statusLabel(status: TripStatus): string {
  switch (status) {
    case 'muted':
      return 'Muted';
    case 'offline':
      return 'Offline';
    case 'listening':
      return 'Listening';
  }
}
