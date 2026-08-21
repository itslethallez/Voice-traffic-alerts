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

/**
 * Switches the audio session into recording mode for the Report dial's
 * tap-and-talk voice notes (Step 12 #26) - `allowsRecording` must be true
 * before AudioRecorder.record() will work. Scoped to just the recording
 * window (ReportDial calls configureDuckingAudioSession() again right
 * after stop()) rather than set globally at drive-loop start, so normal
 * TTS announcement playback is unaffected the rest of the time.
 */
export async function configureRecordingAudioSession(): Promise<void> {
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
  });
}
