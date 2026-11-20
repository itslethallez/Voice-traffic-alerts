import { setAudioModeAsync } from 'expo-audio';

/**
 * Configures the app's audio session to duck (lower, not stop) other
 * audio - music, turn-by-turn navigation - while an announcement plays,
 * rather than interrupting it outright. `interruptionMode: 'duckOthers'`
 * covers both iOS and Android as of expo-audio's current API; there's no
 * separate Android-only flag to set anymore.
 *
 * `shouldPlayInBackground` is what keeps the voice alive with the screen
 * off or another app (Waze, Google Maps) in front. Without it, expo-audio
 * pauses every player the moment the activity leaves the foreground
 * (AudioModule's OnActivityEntersBackground), so a Google TTS clip never
 * finishes and the announcer stalls until googleTts's 20 s timeout.
 * Clips are a few seconds each and the location foreground service keeps
 * the process alive, so the ~3 min Android limit on background playback
 * without lock-screen controls doesn't apply.
 */
export async function configureDuckingAudioSession(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'duckOthers',
  });
}
