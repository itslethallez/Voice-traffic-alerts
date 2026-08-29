import { create } from 'zustand';
import { confirmManualReport, deleteManualReport, submitManualReport } from '../api/backend/client';
import type { ManualReportCategory } from '../api/backend/types';
import type { WazeAlert } from '../api/waze/types';
import { getDeviceId } from '../config/deviceId';
import type { FixedSpeedCamera } from '../data/fixedSpeedCameras';
import type { GeoPoint } from '../geo/types';
import type { RecentAnnouncement } from '../speech/types';

export type { ManualReportCategory };

export type TripStatus = 'listening' | 'muted' | 'offline';

const MAX_RECENT_ANNOUNCEMENTS = 3;

/**
 * localKeys of reports removed via removeManualReport before their
 * background submitManualReport sync (pushManualReport) had resolved. Not
 * store state itself - purely an internal handshake between the two so a
 * report deleted the instant after it was created doesn't silently
 * reappear once its now-orphaned sync call finishes and writes a row this
 * device already asked to have deleted.
 */
const pendingDeleteLocalKeys = new Set<string>();

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
  /**
   * Stable identity for map markers / feed rows / RadarMap's seenAlertIds
   * tracking - distinct from `id`, which pushManualReport swaps from a
   * locally-generated "manual-*" placeholder to the backend's real id once
   * its background sync succeeds. Using `id` for that instead would make a
   * successfully-synced report look like a brand new alert (remounted
   * marker, re-triggered new-alert spotlight) the moment it swaps.
   * localKey is assigned once at creation and never changes afterwards.
   */
  localKey: string;
  createdAtMs: number;
  position: GeoPoint | null;
  headingDeg: number | null;
  category: ManualReportCategory;
  /** Only meaningful for category 'POLICE' (e.g. 'POLICE_VISIBLE') - null
   * for every other category, and for a POLICE report where the driver
   * didn't pick a sub-choice. */
  subtype: string | null;
  /** ms epoch of this report's last confirmation by another device, or its
   * creation if no one's confirmed it yet - manualReportAlert.ts's
   * LIVE_REPORT_WINDOW_MS is measured from this, not createdAtMs, so a
   * corroborated report can stay visible past the base window while an
   * unconfirmed one ages out on schedule. Only ever updated by re-hydrating
   * from the backend (this device has no way to learn about another
   * device's confirmation of its own report mid-trip otherwise). */
  lastConfirmedAtMs: number;
  /** How many other devices have tapped "STILL THERE?" on this report
   * (server/api/reports.ts's corroboration_count) - RadarMap.tsx's closest-
   * alert focus panel shows this as "HIGH · 3×" alongside the confidence
   * tier. 0 until the next backend hydration for a report just created
   * locally (pushManualReport below) - a report can't have been confirmed
   * by anyone before this device has even finished submitting it. */
  corroborationCount: number;
}

/**
 * Another device's report, fetched fresh each poll (trip/tripRuntime.ts's
 * refreshNearbyReports) so this driver can see and confirm it on their own
 * map - the counterpart to ManualReport, which is only ever this device's
 * own reports. Never has a local-id-swap dance (ManualReport's id/localKey
 * split): a NearbyReport is only ever an already-synced backend row, never
 * created optimistically here.
 */
export interface NearbyReport {
  id: string;
  category: ManualReportCategory;
  subtype: string | null;
  position: GeoPoint;
  headingDeg: number | null;
  createdAtMs: number;
  lastConfirmedAtMs: number;
  /** Whether this device has already tapped "confirm" on this report -
   * greys out the confirm affordance instead of re-offering it, and stops
   * confirmNearbyReport from making a pointless repeat backend call. */
  confirmedByThisDevice: boolean;
  /** See ManualReport.corroborationCount above - same field, same source. */
  corroborationCount: number;
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
  /** Read-only mirror of tripRuntime.ts's getActiveFixedCameras() (the
   * live central-DB fetch, falling back to the bundled SAPOL snapshot) -
   * same "radar UI mirror" pattern as driverPosition above. Never filtered
   * by distance here; RadarMap.tsx does that itself the same way it
   * already does for manualReports/nearbyReports, with announceDistanceMeters. */
  fixedCameras: FixedSpeedCamera[];
  manualReports: ManualReport[];
  /** Other devices' nearby, still-live reports - refreshed on the same
   * cadence as the Waze poll (trip/tripRuntime.ts), always a full replace
   * (unlike manualReports' merge-preserving setManualReports) since these
   * are never created optimistically on this device. */
  nearbyReports: NearbyReport[];
  /** ms epoch this trip started - set once from tripRuntime.ts's
   * resetTripRuntime(), the existing "call when a new trip starts" hook.
   * Drives the History header's "THIS TRIP · {n} MIN" line
   * (design_handoff_instrument_face) - null until the trip actually
   * starts. */
  tripStartedAtMs: number | null;
  pushAnnouncement: (announcement: RecentAnnouncement) => void;
  pushManualReport: (category?: ManualReportCategory, subtype?: string | null) => void;
  /** Removes one of this device's own reports, locally and (in the
   * background) on the backend - identified by localKey since that's the
   * one identifier that never changes across the local-id-to-backend-id
   * swap below. */
  removeManualReport: (localKey: string) => void;
  /** Merges the backend's list into manualReports - used once at startup to
   * hydrate from the backend (trip/tripRuntime.ts), not a general-purpose
   * setter. Not a wholesale overwrite: see its implementation below for why. */
  setManualReports: (reports: ManualReport[]) => void;
  /** Replaces nearbyReports wholesale - always a fresh poll snapshot, no
   * merge concerns since nothing here is ever created locally. */
  setNearbyReports: (reports: NearbyReport[]) => void;
  /** Optimistically marks a nearby report confirmed by this device and
   * syncs that in the background - a no-op if already confirmed (the
   * backend would no-op it too, but this also skips the pointless request). */
  confirmNearbyReport: (id: string) => void;
  setOffline: (offline: boolean) => void;
  setBannerMessage: (message: string | null) => void;
  setLocationError: (message: string | null) => void;
  setDriverPosition: (position: GeoPoint, headingDeg: number, speedKmh: number) => void;
  setVisibleAlerts: (alerts: WazeAlert[]) => void;
  setFixedCameras: (cameras: FixedSpeedCamera[]) => void;
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
  fixedCameras: [],
  manualReports: [],
  nearbyReports: [],
  tripStartedAtMs: null,
  pushAnnouncement: (announcement) =>
    set((state) => ({
      recentAnnouncements: [announcement, ...state.recentAnnouncements].slice(
        0,
        MAX_RECENT_ANNOUNCEMENTS
      ),
    })),
  pushManualReport: (category = 'POLICE', subtype = null) => {
    const position = get().driverPosition;
    const headingDeg = position ? get().driverHeadingDeg : null;
    const localId = `manual-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const createdAtMs = Date.now();
    const report: ManualReport = {
      id: localId,
      localKey: localId,
      createdAtMs,
      position,
      headingDeg,
      category,
      subtype,
      lastConfirmedAtMs: createdAtMs,
      corroborationCount: 0,
    };
    set((state) => ({ manualReports: [report, ...state.manualReports] }));

    // Fire-and-forget: a driver tapping "Report" gets the same instant
    // local confirmation regardless of network state. A sync failure is
    // logged, not surfaced - this app treats background data/sync issues
    // as non-blocking (Waze cache-on-failure, offline banner) rather than
    // alarming mid-drive, and there's no location to report yet if
    // position is null.
    if (position) {
      void (async () => {
        try {
          const deviceId = await getDeviceId();
          const remote = await submitManualReport({ deviceId, position, headingDeg, category, subtype });
          if (pendingDeleteLocalKeys.has(localId)) {
            // removeManualReport already ran for this report before its
            // sync resolved - there was nothing to delete on the backend
            // yet at that point, so do it now instead of reinserting a
            // report the driver already asked to remove.
            pendingDeleteLocalKeys.delete(localId);
            try {
              await deleteManualReport({ id: remote.id, deviceId });
            } catch (error) {
              console.warn('[reports] failed to delete manual report from the backend', error);
            }
            return;
          }
          // Swap the optimistic local id for the backend's real one. The
          // backend assigns its own id (never the "manual-" one this
          // function generated), so without this, setManualReports'
          // startup-hydration merge below has no way to recognise this
          // report as already-synced if that fetch resolves after this -
          // it would keep the local entry *and* add the hydrated one,
          // showing the same report twice.
          set((state) => ({
            manualReports: state.manualReports.map((r) => (r.id === localId ? { ...r, id: remote.id } : r)),
          }));
        } catch (error) {
          console.warn('[reports] failed to sync manual report to the backend', error);
        }
      })();
    }
  },
  removeManualReport: (localKey) => {
    const report = get().manualReports.find((r) => r.localKey === localKey);
    if (!report) return;
    set((state) => ({ manualReports: state.manualReports.filter((r) => r.localKey !== localKey) }));

    if (report.id.startsWith('manual-')) {
      // Still mid-flight to the backend (or never had a position to sync
      // at all) - nothing to delete there yet. Flag it so pushManualReport's
      // sync callback deletes it the moment it lands instead of the report
      // reappearing next time manualReports is hydrated from the backend.
      pendingDeleteLocalKeys.add(localKey);
      return;
    }

    void (async () => {
      try {
        const deviceId = await getDeviceId();
        await deleteManualReport({ id: report.id, deviceId });
      } catch (error) {
        console.warn('[reports] failed to delete manual report from the backend', error);
      }
    })();
  },
  setManualReports: (reports) =>
    set((state) => {
      // hydrateManualReportsFromBackend (tripRuntime.ts) runs once,
      // fire-and-forget, at trip start - if the driver taps "Report
      // police" (pushManualReport, above) before that fetch resolves, a
      // plain overwrite here would wipe the optimistic local entry from
      // the UI even though its background sync may well still succeed.
      // Locally-generated reports (the "manual-" id prefix pushManualReport
      // uses, distinct from whatever id format the backend assigns its own
      // rows) that aren't already present in the fetched list are kept
      // alongside it instead of being replaced.
      const remoteIds = new Set(reports.map((r) => r.id));
      const notYetReconciled = state.manualReports.filter(
        (r) => r.id.startsWith('manual-') && !remoteIds.has(r.id)
      );
      return {
        manualReports: [...notYetReconciled, ...reports].sort((a, b) => b.createdAtMs - a.createdAtMs),
      };
    }),
  setNearbyReports: (reports) => set({ nearbyReports: reports }),
  confirmNearbyReport: (id) => {
    const report = get().nearbyReports.find((r) => r.id === id);
    if (!report || report.confirmedByThisDevice) return;
    const confirmedAtMs = Date.now();
    set((state) => ({
      nearbyReports: state.nearbyReports.map((r) =>
        r.id === id
          ? { ...r, confirmedByThisDevice: true, lastConfirmedAtMs: confirmedAtMs, corroborationCount: r.corroborationCount + 1 }
          : r
      ),
    }));

    void (async () => {
      try {
        const deviceId = await getDeviceId();
        await confirmManualReport({ id, deviceId });
      } catch (error) {
        console.warn('[reports] failed to confirm a nearby report on the backend', error);
      }
    })();
  },
  setOffline: (offline) => set({ isOffline: offline }),
  setBannerMessage: (message) => set({ bannerMessage: message }),
  setLocationError: (message) => set({ locationError: message }),
  setDriverPosition: (position, headingDeg, speedKmh) =>
    set({ driverPosition: position, driverHeadingDeg: headingDeg, driverSpeedKmh: speedKmh }),
  setVisibleAlerts: (alerts) => set({ visibleAlerts: alerts }),
  setFixedCameras: (cameras) => set({ fixedCameras: cameras }),
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
