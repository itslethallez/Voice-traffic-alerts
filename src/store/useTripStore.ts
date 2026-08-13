import { create } from 'zustand';
import type { RecentAnnouncement } from '../speech/types';

export type TripStatus = 'listening' | 'muted' | 'offline';

const MAX_RECENT_ANNOUNCEMENTS = 3;

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
  pushAnnouncement: (announcement: RecentAnnouncement) => void;
  setOffline: (offline: boolean) => void;
  setBannerMessage: (message: string | null) => void;
  setLocationError: (message: string | null) => void;
}

export const useTripStore = create<TripStoreState>((set) => ({
  isOffline: false,
  bannerMessage: null,
  locationError: null,
  recentAnnouncements: [],
  pushAnnouncement: (announcement) =>
    set((state) => ({
      recentAnnouncements: [announcement, ...state.recentAnnouncements].slice(
        0,
        MAX_RECENT_ANNOUNCEMENTS
      ),
    })),
  setOffline: (offline) => set({ isOffline: offline }),
  setBannerMessage: (message) => set({ bannerMessage: message }),
  setLocationError: (message) => set({ locationError: message }),
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
