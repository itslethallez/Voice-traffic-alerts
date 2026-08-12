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
  rateLimitBannerVisible: boolean;
  locationError: string | null;
  recentAnnouncements: RecentAnnouncement[];
  pushAnnouncement: (announcement: RecentAnnouncement) => void;
  setOffline: (offline: boolean) => void;
  setRateLimitBannerVisible: (visible: boolean) => void;
  setLocationError: (message: string | null) => void;
}

export const useTripStore = create<TripStoreState>((set) => ({
  isOffline: false,
  rateLimitBannerVisible: false,
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
  setRateLimitBannerVisible: (visible) => set({ rateLimitBannerVisible: visible }),
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
