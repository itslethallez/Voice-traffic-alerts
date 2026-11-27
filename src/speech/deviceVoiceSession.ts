import { Platform } from 'react-native';
import { setIsAudioActiveAsync } from 'expo-audio';
import { appStateLabel } from '../diagnostics/appState';

/**
 * iOS only: hand the audio session back after the on-device voice speaks.
 *
 * Google TTS clips play through expo-audio, which deactivates the session
 * (with notifyOthersOnDeactivation) when a clip finishes - that is what
 * un-ducks the driver's music / Apple Maps voice. The device voice is
 * expo-speech (AVSpeechSynthesizer), which activates the same shared
 * session to speak but never deactivates it, so after a device-voice
 * alert - and speed-camera warnings are device-voice-first - other audio
 * would stay ducked until the next Google clip happened to end.
 *
 * Android needs nothing here: TextToSpeech releases its own audio focus.
 * Best-effort - a failure only leaves other audio ducked, never silences
 * an alert.
 */
export async function releaseAudioSessionAfterDeviceSpeech(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    await setIsAudioActiveAsync(false);
    console.log(`[speech] device voice done - audio session released app=${appStateLabel()}`);
  } catch (error) {
    console.log(`[speech] could not release audio session after device voice: ${String(error)}`);
  }
}
