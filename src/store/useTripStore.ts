import { create } from 'zustand';
import { submitManualReport } from '../api/backend/client';
import type { WazeAlert } from '../api/waze/types';
import { getDeviceId } from '../config/deviceId';
import type { GeoPoint } from '../geo/types';
import type { RecentAnnouncement } from '../speech/types';

export type TripStatus = 'listening' | 'muted' | 'offline';

const MAX_RECENT_ANNOUNCEMENTS = 3;

/**
 * A driver-initiated one-tap "Report police". Pushed to local state
 * immediately (so the UI's "REPORTED" confirmation and History screen are
 * never waiting on a network round trip) and separately synced to the
 * shared backend in the background - see submitManualReport below and
 * trip/tripRuntime.ts's startup hydration, which reads these back via
 * fetchOwnReports so they survive a relaunch.
 */
export interface ManualReport {
  id: string;
  createdAtMs: number;
  position: GeoPoint | null;
  headingDeg: number | null;
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
  /** Km/h, mirrored from DriverState.speedKmh (Step 13's Drive-screen
   * speedometer) - same read-only "radar UI mirror" pattern as
   * driverPosition/driverHeadingDeg above. */
  driverSpeedKmh: number;
  visibleAlerts: WazeAlert[];
  manualReports: ManualReport[];
  /** ms epoch this trip started - set once from tripRuntime.ts's
   * resetTripRuntime(), the existing "call when a new trip starts" hook.
   * Drives the History header's "THIS TRIP · {n} MIN" line
   * (design_handoff_instrument_face) - null until the trip actually
   * starts. */
  tripStartedAtMs: number | null;
  pushAnnouncement: (announcement: RecentAnnouncement) => void;
  pushManualReport: () => void;
  /** Overwrites manualReports wholesale - used once at startup to hydrate
   * from the backend (trip/tripRuntime.ts), not a general-purpose setter. */
  setManualReports: (reports: ManualReport[]) => void;
  setOffline: (offline: boolean) => void;
  setBannerMessage: (message: string | null) => void;
  setLocationError: (message: string | null) => void;
  setDriverPosition: (position: GeoPoint, headingDeg: number, speedKmh: number) => void;
  setVisibleAlerts: (alerts: WazeAlert[]) => void;
  setTripStartedAtMs: (atMs: number) => void;
}

export const useTripStore = create<TripStoreState>((set, get) => ({
  isOffline: false,
  bannerMessage: null,
  locationError: null,
  recentAnnouncements: [],
  driverPosition: null,
  driverHeadingDeg: 0,
  driverSpeedKmh: 0,
  visibleAlerts: [],
  manualReports: [],
  tripStartedAtMs: null,
  pushAnnouncement: (announcement) =>
    set((state) => ({
      recentAnnouncements: [announcement, ...state.recentAnnouncements].slice(
        0,
        MAX_RECENT_ANNOUNCEMENTS
      ),
    })),
  pushManualReport: () => {
    const position = get().driverPosition;
    const headingDeg = position ? get().driverHeadingDeg : null;
    const report: ManualReport = {
      id: `manual-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      createdAtMs: Date.now(),
      position,
      headingDeg,
    };
    set((state) => ({ manualReports: [report, ...state.manualReports] }));

    // Fire-and-forget: a driver tapping "Report police" gets the same
    // instant local confirmation regardless of network state. A sync
    // failure is logged, not surfaced - this app treats background
    // data/sync issues as non-blocking (Waze cache-on-failure, offline
    // banner) rather than alarming mid-drive, and there's no location to
    // report yet if position is null.
    if (position) {
      void (async () => {
        try {
          const deviceId = await getDeviceId();
          await submitManualReport({ deviceId, position, headingDeg });
        } catch (error) {
          console.warn('[reports] failed to sync manual report to the backend', error);
        }
      })();
    }
  },
  setManualReports: (reports) => set({ manualReports: reports }),
  setOffline: (offline) => set({ isOffline: offline }),
  setBannerMessage: (message) => set({ bannerMessage: message }),
  setLocationError: (message) => set({ locationError: message }),
  setDriverPosition: (position, headingDeg, speedKmh) =>
    set({ driverPosition: position, driverHeadingDeg: headingDeg, driverSpeedKmh: speedKmh }),
  setVisibleAlerts: (alerts) => set({ visibleAlerts: alerts }),
  setTripStartedAtMs: (atMs) => set({ tripStartedAtMs: atMs }),
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
