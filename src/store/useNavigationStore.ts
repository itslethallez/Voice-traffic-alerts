import { create } from 'zustand';
import type { MapboxRouteStep } from '../api/mapbox/types';
import type { GeoPoint } from '../geo/types';

export type NavigationStatus = 'idle' | 'routing' | 'navigating' | 'rerouting' | 'arrived' | 'error';

export interface NavigationRoute {
  polyline: GeoPoint[];
  steps: MapboxRouteStep[];
  distanceMeters: number;
  durationSeconds: number;
  /** The winning route's own hazard-exposure score (0 whenever avoidHazards
   * was off for this request) - kept mainly for a future "N hazards on
   * this route" UI affordance, not used by the engine itself once a route
   * is chosen. */
  hazardScore: number;
}

/**
 * Ephemeral, engine-owned navigation state - the same "mirror of
 * navigationRuntime.ts's module-level state, written by the engine, read
 * by UI" convention useTripStore.ts already follows for tripRuntime.ts.
 * Actions here are called by navigationRuntime.ts, not driven by UI logic
 * directly (a screen calls navigationRuntime.startNavigation() etc., which
 * calls these in turn).
 */
interface NavigationStoreState {
  status: NavigationStatus;
  destination: GeoPoint | null;
  destinationLabel: string | null;
  activeRoute: NavigationRoute | null;
  currentStepIndex: number;
  distanceToNextManeuverM: number | null;
  remainingDistanceM: number | null;
  etaMs: number | null;
  errorMessage: string | null;
  setRouting: () => void;
  setActiveRoute: (input: { destination: GeoPoint; destinationLabel: string | null; route: NavigationRoute }) => void;
  setStepProgress: (input: {
    currentStepIndex: number;
    distanceToNextManeuverM: number;
    remainingDistanceM: number;
    etaMs: number;
  }) => void;
  setRerouting: () => void;
  setError: (message: string) => void;
  stop: () => void;
}

const IDLE_STATE = {
  status: 'idle' as const,
  destination: null,
  destinationLabel: null,
  activeRoute: null,
  currentStepIndex: 0,
  distanceToNextManeuverM: null,
  remainingDistanceM: null,
  etaMs: null,
  errorMessage: null,
};

export const useNavigationStore = create<NavigationStoreState>((set) => ({
  ...IDLE_STATE,
  setRouting: () => set({ status: 'routing', errorMessage: null }),
  setActiveRoute: ({ destination, destinationLabel, route }) =>
    set({
      status: 'navigating',
      destination,
      destinationLabel,
      activeRoute: route,
      currentStepIndex: 0,
      distanceToNextManeuverM: route.steps[0]?.distance ?? null,
      remainingDistanceM: route.distanceMeters,
      etaMs: Date.now() + route.durationSeconds * 1000,
      errorMessage: null,
    }),
  setStepProgress: ({ currentStepIndex, distanceToNextManeuverM, remainingDistanceM, etaMs }) =>
    // Rerouting resolves back to 'navigating' the moment setActiveRoute
    // fires (a fresh route), not from this - so a stale progress tick that
    // races a reroute in flight can't flip status back early.
    set((state) => ({
      status: state.status === 'rerouting' ? state.status : 'navigating',
      currentStepIndex,
      distanceToNextManeuverM,
      remainingDistanceM,
      etaMs,
    })),
  setRerouting: () => set({ status: 'rerouting' }),
  setError: (message) => set({ status: 'error', errorMessage: message }),
  stop: () => set({ ...IDLE_STATE }),
}));
