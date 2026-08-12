import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  type AlertCategory,
  clamp,
  defaultSettingsValues,
  MAX_ANNOUNCE_DISTANCE_METERS,
  MAX_VOICE_RATE,
  MAX_VOICE_VOLUME,
  MIN_ANNOUNCE_DISTANCE_METERS,
  MIN_VOICE_RATE,
  MIN_VOICE_VOLUME,
  type SettingsValues,
} from './settingsDefaults';

interface SettingsStore extends SettingsValues {
  toggleCategory: (category: AlertCategory) => void;
  setAnnounceDistanceMeters: (meters: number) => void;
  setVoiceVolume: (volume: number) => void;
  setVoiceRate: (rate: number) => void;
  toggleMasterMute: () => void;
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
      setAnnounceDistanceMeters: (meters) =>
        set({
          announceDistanceMeters: clamp(
            meters,
            MIN_ANNOUNCE_DISTANCE_METERS,
            MAX_ANNOUNCE_DISTANCE_METERS
          ),
        }),
      setVoiceVolume: (volume) =>
        set({ voiceVolume: clamp(volume, MIN_VOICE_VOLUME, MAX_VOICE_VOLUME) }),
      setVoiceRate: (rate) => set({ voiceRate: clamp(rate, MIN_VOICE_RATE, MAX_VOICE_RATE) }),
      toggleMasterMute: () => set((state) => ({ masterMute: !state.masterMute })),
    }),
    {
      name: 'voice-traffic-alerts/settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
