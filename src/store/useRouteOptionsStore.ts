import { create } from 'zustand';
import type { HazardNearRoute, RouteHazard } from '../engine/routeHazardScore';
import type { GeoPoint } from '../geo/types';
import type { NavigationRoute } from './useNavigationStore';

export type RouteOptionId = 'fastest' | 'safest' | 'sidestreets';

export type RouteOptionsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface RouteOption {
  id: RouteOptionId;
  route: NavigationRoute;
  /** Live hazards within this route's corridor (nearest to the driver's
   * start first) - what the card's "avoids N" reason line and Stage C's
   * "hazards on route" list are built from. */
  hazardsOnRoute: HazardNearRoute<RouteHazard>[];
}

/**
 * Ephemeral route-planning state - the stage between picking a destination
 * (NavigationSearchScreen) and committing to turn-by-turn (Stage C's
 * navigationRuntime/useNavigationStore). Written by
 * navigation/routeOptions.ts's loadRouteOptions, read by RadarMap's
 * preview lines and the RouteOptionsPanel cards. Deliberately separate
 * from useNavigationStore: nothing here implies an active trip, so Stage
 * C's "is navigation driving the trip" checks (isNavigationActive etc.)
 * stay untouched until a real handoff exists.
 */
interface RouteOptionsStoreState {
  status: RouteOptionsStatus;
  destination: GeoPoint | null;
  destinationLabel: string | null;
  /** The candidates that came back - 'fastest' and 'safest' are always
   * present once status is 'ready' (they may share the same geometry);
   * 'sidestreets' is absent when Mapbox returned no motorway-free route. */
  options: RouteOption[];
  /** Which card's geometry the map emphasises - the driver's pick for
   * Stage C's eventual handoff. Defaults to 'fastest' on setReady. */
  selectedId: RouteOptionId | null;
  errorMessage: string | null;
  startLoading: (input: { destination: GeoPoint; destinationLabel: string | null }) => void;
  setReady: (options: RouteOption[]) => void;
  setError: (message: string) => void;
  select: (id: RouteOptionId) => void;
  clear: () => void;
}

const IDLE_STATE = {
  status: 'idle' as const,
  destination: null,
  destinationLabel: null,
  options: [] as RouteOption[],
  selectedId: null,
  errorMessage: null,
};

export const useRouteOptionsStore = create<RouteOptionsStoreState>((set) => ({
  ...IDLE_STATE,
  startLoading: ({ destination, destinationLabel }) =>
    set({ status: 'loading', destination, destinationLabel, options: [], selectedId: null, errorMessage: null }),
  setReady: (options) => set({ status: 'ready', options, selectedId: 'fastest', errorMessage: null }),
  setError: (message) => set({ status: 'error', errorMessage: message }),
  select: (id) => set({ selectedId: id }),
  clear: () => set({ ...IDLE_STATE }),
}));
