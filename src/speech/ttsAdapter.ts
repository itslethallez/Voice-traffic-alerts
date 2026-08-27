import * as Speech from 'expo-speech';
import { speakWithGoogleTtsAsync, stopGoogleTtsSpeech } from './googleTts';

export interface SpeakOptions {
  rate?: number;
  volume?: number;
}

/**
 * Promise wrapper around expo-speech's callback-based speak() - the
 * on-device fallback voice, used when Google TTS is unavailable.
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
 * The most recent reason Google TTS fell back to the on-device voice, or
 * null if the last attempt succeeded (or none has happened yet).
 * speakAsync()'s whole point is to never let a TTS failure reach the
 * caller - the driver always hears something - but that same design
 * makes the failure itself invisible to anyone debugging why the voice
 * doesn't sound like Google's. A lightweight escape hatch for that,
 * without ttsAdapter/googleTts needing to know about the store or UI
 * layer.
 */
let lastGoogleTtsError: string | null = null;

export function getLastGoogleTtsError(): string | null {
  return lastGoogleTtsError;
}

/**
 * Speaks via Google Cloud Text-to-Speech first, falling back to the
 * on-device voice if the request or playback fails - offline, a Google
 * TTS outage, a missing key, a rate limit. This is a driving-safety
 * feature: a network hiccup must never mean the driver hears nothing, so
 * a TTS failure only reaches the caller (see announcer.ts's "never crash
 * the loop" handling) once both voices have failed.
 */
export async function speakAsync(text: string, options: SpeakOptions = {}): Promise<void> {
  try {
    await speakWithGoogleTtsAsync(text, options);
    lastGoogleTtsError = null;
  } catch (error) {
    lastGoogleTtsError = error instanceof Error ? error.message : String(error);
    console.warn('[speech] Google TTS failed, falling back to the on-device voice', error);
    await speakWithDeviceAsync(text, options);
  }
}

/**
 * Stops whichever backend might currently be speaking. Both stop calls
 * are unconditional no-ops when their backend isn't active, so this
 * doesn't need to track which one actually spoke last.
 */
export function stopSpeaking(): Promise<void> {
  stopGoogleTtsSpeech();
  return Speech.stop();
}
