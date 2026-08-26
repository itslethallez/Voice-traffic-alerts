import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

/**
 * The only identifier the backend's abuse-prevention model needs (device ID
 * + rate limiting, no accounts - see server/api/reports.ts). Generated once
 * per install and persisted in AsyncStorage, same mechanism
 * useSettingsStore.ts already uses - not tied to any real-world identity,
 * and reset by an app reinstall like any other AsyncStorage data.
 */
const DEVICE_ID_STORAGE_KEY = 'voice-traffic-alerts/deviceId';

let cachedDeviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  const stored = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (stored) {
    cachedDeviceId = stored;
    return stored;
  }

  const generated = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
  cachedDeviceId = generated;
  return generated;
}
