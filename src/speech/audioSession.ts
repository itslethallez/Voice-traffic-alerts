import { setAudioModeAsync } from 'expo-audio';

/**
 * Configures the app's audio session to duck (lower, not stop) other
 * audio - music, turn-by-turn navigation - while an announcement plays,
 * rather than interrupting it outright. `interruptionMode: 'duckOthers'`
 * covers both iOS and Android as of expo-audio's current API; there's no
 * separate Android-only flag to set anymore.
 */
export async function configureDuckingAudioSession(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
  });
}
