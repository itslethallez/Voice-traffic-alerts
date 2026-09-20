import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  type AlertCategory,
  type AlertFilterCategory,
  clamp,
  defaultSettingsValues,
  MAX_ANNOUNCE_DISTANCE_METERS,
  MAX_BRIEFING_RADIUS_METERS,
  MAX_VOICE_RATE,
  MAX_VOICE_VOLUME,
  MIN_ANNOUNCE_DISTANCE_METERS,
  MIN_BRIEFING_RADIUS_METERS,
  MIN_VOICE_RATE,
  MIN_VOICE_VOLUME,
  type RouteType,
  type SettingsValues,
} from './settingsDefaults';

/** zustand's default persist merge is shallow: a persisted record field
 * would REPLACE defaults wholesale, so an install saved before a new
 * category shipped would have no key for it (read as falsy - silently
 * off). Deep-merge just the two category records so new keys pick up
 * their defaults while saved values still win. Exported for tests. */
export function mergePersistedSettings<T extends SettingsValues>(
  persisted: Partial<SettingsValues> | undefined,
  current: T
): T {
  return {
    ...current,
    ...persisted,
    categoriesEnabled: {
      ...defaultSettingsValues.categoriesEnabled,
      ...persisted?.categoriesEnabled,
    },
    alertTypeFilters: {
      ...defaultSettingsValues.alertTypeFilters,
      ...persisted?.alertTypeFilters,
    },
  };
}

interface SettingsStore extends SettingsValues {
  toggleCategory: (category: AlertCategory) => void;
  toggleAlertTypeFilter: (category: AlertFilterCategory) => void;
  setAnnounceDistanceMeters: (meters: number) => void;
  setBriefingRadiusMeters: (meters: number) => void;
  setVoiceVolume: (volume: number) => void;
  setVoiceRate: (rate: number) => void;
  toggleMasterMute: () => void;
  toggleRangeOnMap: () => void;
  setDefaultRouteType: (routeType: RouteType) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaultSettingsValues,
      toggleCategory: (category) =>
        set((state) => ({
          categoriesEnabled: {
            ...state.categoriesEnabled,
            [category]: !state.categoriesEnabled[category],
          },
        })),
      toggleAlertTypeFilter: (category) =>
        set((state) => ({
          alertTypeFilters: {
            ...state.alertTypeFilters,
            [category]: !state.alertTypeFilters[category],
          },
        })),
      setAnnounceDistanceMeters: (meters) =>
        set({
          announceDistanceMeters: clamp(
            meters,
            MIN_ANNOUNCE_DISTANCE_METERS,
            MAX_ANNOUNCE_DISTANCE_METERS
          ),
        }),
      setBriefingRadiusMeters: (meters) =>
        set({
          briefingRadiusMeters: clamp(meters, MIN_BRIEFING_RADIUS_METERS, MAX_BRIEFING_RADIUS_METERS),
        }),
      setVoiceVolume: (volume) =>
        set({ voiceVolume: clamp(volume, MIN_VOICE_VOLUME, MAX_VOICE_VOLUME) }),
      setVoiceRate: (rate) => set({ voiceRate: clamp(rate, MIN_VOICE_RATE, MAX_VOICE_RATE) }),
      toggleMasterMute: () => set((state) => ({ masterMute: !state.masterMute })),
      toggleRangeOnMap: () => set((state) => ({ showRangeOnMap: !state.showRangeOnMap })),
      setDefaultRouteType: (routeType) => set({ defaultRouteType: routeType }),
    }),
    {
      name: 'voice-traffic-alerts/settings',
      storage: createJSONStorage(() => AsyncStorage),
      merge: (persisted, current) =>
        mergePersistedSettings(persisted as Partial<SettingsValues> | undefined, current),
    }
  )
);
