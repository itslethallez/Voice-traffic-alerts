import { create } from 'zustand';
import type { RecentAnnouncement } from '../speech/types';

export type TripStatus = 'listening' | 'muted' | 'offline';

const MAX_RECENT_ANNOUNCEMENTS = 3;

interface TripStoreState {
  isMuted: boolean;
  isOffline: boolean;
  rateLimitBannerVisible: boolean;
  locationError: string | null;
  recentAnnouncements: RecentAnnouncement[];
  toggleMute: () => void;
  pushAnnouncement: (announcement: RecentAnnouncement) => void;
  setOffline: (offline: boolean) => void;
  setRateLimitBannerVisible: (visible: boolean) => void;
  setLocationError: (message: string | null) => void;
}

export const useTripStore = create<TripStoreState>((set) => ({
  isMuted: false,
  isOffline: false,
  rateLimitBannerVisible: false,
  locationError: null,
  recentAnnouncements: [],
  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),
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

export function statusFor(state: { isMuted: boolean; isOffline: boolean }): TripStatus {
  if (state.isMuted) return 'muted';
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
