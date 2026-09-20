import * as Speech from 'expo-speech';
import { isPhoneCallActive } from './callState';
import { GOOGLE_TTS_RETRY_COOLDOWN_MS } from './constants';
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
 * Once Google TTS fails, this holds the timestamp (Date.now()-comparable)
 * before which speakAsync() won't try Google again - see
 * GOOGLE_TTS_RETRY_COOLDOWN_MS. 0 means "not in a cooldown, try Google
 * normally next time."
 */
let googleTtsRetryAtMs = 0;

/**
 * Speaks via Google Cloud Text-to-Speech first, falling back to the
 * on-device voice if the request or playback fails - offline, a Google
 * TTS outage, a missing key, a rate limit. This is a driving-safety
 * feature: a network hiccup must never mean the driver hears nothing, so
 * a TTS failure only reaches the caller (see announcer.ts's "never crash
 * the loop" handling) once both voices have failed.
 *
 * Skips speaking entirely (rejects) while a phone call is active
 * (callState.ts) - neither backend is call-aware on its own (Google TTS
 * would happily duck the call, and expo-speech's on-device voice doesn't
 * check call state at all), so this is the one place that can stop the
 * driver's phone call from getting talked over. Rejecting rather than
 * resolving matters: every caller (tick(), checkSpeedCameraWarning,
 * speakBriefing) already treats a rejection as "not actually spoken" and
 * leaves the alert eligible to be re-offered once the call ends, instead
 * of wrongly marking it announced.
 */
export async function speakAsync(text: string, options: SpeakOptions = {}): Promise<void> {
  if (isPhoneCallActive()) {
    throw new Error('Phone call in progress');
  }

  const now = Date.now();
  if (now < googleTtsRetryAtMs) {
    // Still within the post-failure cooldown - go straight to the device
    // voice rather than retrying Google fresh for every alert, which is
    // what caused the two very different-sounding voices to flip-flop
    // audibly whenever conditions were merely patchy rather than fully
    // down. lastGoogleTtsError is deliberately left as-is here (not
    // re-set to the same message) - it already reflects why we're in the
    // cooldown.
    await speakWithDeviceAsync(text, options);
    return;
  }

  try {
    await speakWithGoogleTtsAsync(text, options);
    lastGoogleTtsError = null;
    googleTtsRetryAtMs = 0;
  } catch (error) {
    lastGoogleTtsError = error instanceof Error ? error.message : String(error);
    googleTtsRetryAtMs = Date.now() + GOOGLE_TTS_RETRY_COOLDOWN_MS;
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
