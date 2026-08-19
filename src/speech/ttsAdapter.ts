import * as Speech from 'expo-speech';
import { speakWithElevenLabsAsync, stopElevenLabsSpeech } from './elevenLabsTts';

export interface SpeakOptions {
  rate?: number;
  volume?: number;
}

/**
 * Promise wrapper around expo-speech's callback-based speak() - the
 * on-device fallback voice, used when ElevenLabs is unavailable.
 */
function speakWithDeviceAsync(text: string, options: SpeakOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    Speech.speak(text, {
      rate: options.rate,
      volume: options.volume,
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: (error) => reject(error),
    });
  });
}

/**
 * Speaks via ElevenLabs first, falling back to the on-device voice if the
 * request or playback fails - offline, an ElevenLabs outage, a missing
 * key, a rate limit. This is a driving-safety feature: a network hiccup
 * must never mean the driver hears nothing, so a TTS failure only
 * reaches the caller (see announcer.ts's "never crash the loop" handling)
 * once both voices have failed.
 */
export async function speakAsync(text: string, options: SpeakOptions = {}): Promise<void> {
  try {
    await speakWithElevenLabsAsync(text, options);
  } catch (error) {
    console.warn('[speech] ElevenLabs TTS failed, falling back to the on-device voice', error);
    await speakWithDeviceAsync(text, options);
  }
}

/**
 * Stops whichever backend might currently be speaking. Both stop calls
 * are unconditional no-ops when their backend isn't active, so this
 * doesn't need to track which one actually spoke last.
 */
export function stopSpeaking(): Promise<void> {
  stopElevenLabsSpeech();
  return Speech.stop();
}
