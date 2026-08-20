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
 * The most recent reason ElevenLabs fell back to the on-device voice, or
 * null if the last attempt succeeded (or none has happened yet).
 * speakAsync()'s whole point is to never let a TTS failure reach the
 * caller - the driver always hears something - but that same design
 * makes the failure itself invisible to anyone debugging why the voice
 * doesn't sound like ElevenLabs. This is a lightweight escape hatch: the
 * UI (DriveScreen) polls it to show the exact error on-screen, without
 * ttsAdapter/elevenLabsTts needing to know about the store or UI layer.
 */
let lastElevenLabsError: string | null = null;

export function getLastElevenLabsError(): string | null {
  return lastElevenLabsError;
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
    lastElevenLabsError = null;
  } catch (error) {
    lastElevenLabsError = error instanceof Error ? error.message : String(error);
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
