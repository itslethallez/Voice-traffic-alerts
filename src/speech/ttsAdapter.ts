import * as Speech from 'expo-speech';
import { appStateLabel } from '../diagnostics/appState';
import { isPhoneCallActive } from './callState';
import { GOOGLE_TTS_READY_DEADLINE_MS, GOOGLE_TTS_RETRY_COOLDOWN_MS } from './constants';
import { GoogleTtsNotReadyError, speakWithGoogleTtsAsync, stopGoogleTtsSpeech } from './googleTts';
import { prefetchTtsAudio } from './ttsAudioCache';

export interface SpeakOptions {
  rate?: number;
  volume?: number;
}

/**
 * Promise wrapper around expo-speech's callback-based speak() - the
 * on-device fallback voice, used when Google TTS is unavailable.
 */
function speakWithDeviceAsync(text: string, options: SpeakOptions = {}): Promise<void> {
  const startedAtMs = Date.now();
  return new Promise((resolve, reject) => {
    Speech.speak(text, {
      rate: options.rate,
      volume: options.volume,
      onStart: () =>
        console.log(
          `[speech] first sound after ${Date.now() - startedAtMs}ms voice=device app=${appStateLabel()}`
        ),
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
    console.log('[speech] skipped - phone call in progress');
    throw new Error('Phone call in progress');
  }

  const now = Date.now();
  // Every branch below is tagged [speech] with the app state at the time,
  // because "the voice kept going with the screen off" is only provable
  // from a log line that says both that it spoke AND that the app wasn't
  // on screen when it did - see diagnostics/appState.ts.
  const app = appStateLabel();
  if (now < googleTtsRetryAtMs) {
    // Still within the post-failure cooldown - go straight to the device
    // voice rather than retrying Google fresh for every alert, which is
    // what caused the two very different-sounding voices to flip-flop
    // audibly whenever conditions were merely patchy rather than fully
    // down. lastGoogleTtsError is deliberately left as-is here (not
    // re-set to the same message) - it already reflects why we're in the
    // cooldown.
    console.log(`[speech] device (google in cooldown) app=${app} "${text}"`);
    await speakWithDeviceAsync(text, options);
    console.log(`[speech] spoke via device in ${Date.now() - now}ms app=${appStateLabel()}`);
    return;
  }

  console.log(`[speech] google app=${app} "${text}"`);
  try {
    await speakWithGoogleTtsAsync(text, { ...options, readyDeadlineMs: GOOGLE_TTS_READY_DEADLINE_MS });
    lastGoogleTtsError = null;
    googleTtsRetryAtMs = 0;
    console.log(`[speech] spoke via google in ${Date.now() - now}ms app=${appStateLabel()}`);
  } catch (error) {
    if (error instanceof GoogleTtsNotReadyError) {
      // Slow, not broken: speak now on the device voice, keep Google
      // primary for the next one. Same fallback-to-the-caller semantics:
      // if the device voice also fails, the rejection propagates.
      console.log(`[speech] device (google not ready) app=${appStateLabel()} "${text}"`);
      await speakWithDeviceAsync(text, options);
      console.log(`[speech] spoke via device in ${Date.now() - now}ms app=${appStateLabel()}`);
      return;
    }
    lastGoogleTtsError = error instanceof Error ? error.message : String(error);
    googleTtsRetryAtMs = Date.now() + GOOGLE_TTS_RETRY_COOLDOWN_MS;
    console.warn(
      `[speech] Google TTS failed after ${Date.now() - now}ms (app=${appStateLabel()}), falling back to the on-device voice`,
      error
    );
    const deviceStartedAtMs = Date.now();
    await speakWithDeviceAsync(text, options);
    console.log(
      `[speech] spoke via device in ${Date.now() - deviceStartedAtMs}ms app=${appStateLabel()}`
    );
  }
}

/**
 * For the fixed-checkpoint speed-camera / corroborated-police-report
 * warning only: the on-device voice first, Google only if that fails.
 *
 * That warning fires at 500m and 200m. Google's ~0.9s round-trip is ~25m
 * of silence at 100 km/h - an eighth of the 200m checkpoint's margin -
 * while the device voice has no network step at all. Every other
 * announcement keeps Google first (speakAsync): it's spoken km out, where
 * a second is nothing, and voice quality matters more there.
 *
 * Interrupts whatever is already speaking, on either voice, instead of
 * talking over it - same as speakWithGoogleTtsAsync's self-preemption,
 * extended to cover the switch of voices.
 *
 * Phone-call behaviour is speakAsync's: rejects without speaking, so the
 * caller leaves the checkpoint unfired and it's offered again.
 */
export async function speakUrgentAsync(text: string, options: SpeakOptions = {}): Promise<void> {
  if (isPhoneCallActive()) {
    console.log('[speech] skipped urgent - phone call in progress');
    throw new Error('Phone call in progress');
  }

  const now = Date.now();
  stopGoogleTtsSpeech();
  await Speech.stop();
  console.log(`[speech] device (urgent) app=${appStateLabel()} "${text}"`);
  try {
    await speakWithDeviceAsync(text, options);
    console.log(`[speech] spoke via device in ${Date.now() - now}ms app=${appStateLabel()}`);
  } catch (error) {
    console.warn(
      `[speech] device voice failed for urgent warning after ${Date.now() - now}ms (app=${appStateLabel()}), trying Google`,
      error
    );
    await speakAsync(text, options);
  }
}

/**
 * Binds and initialises the on-device TTS engine ahead of the first urgent
 * warning. expo-speech creates Android's TextToSpeech lazily on first use,
 * and the first drive test after switching the camera warning to the
 * device voice measured that cold start at 3175ms to first sound - bind
 * ~0.3s, voice-model load ~2.5s, synthesis ~0.35s - far worse than the
 * Google round-trip it replaced. getAvailableVoicesAsync() forces the bind
 * and waits for the engine's init callback without making a sound.
 *
 * Only the first successful call does any work; a failure (no engine
 * installed, init error) is logged and retried on the next call.
 */
let deviceVoiceWarmUp: Promise<void> | null = null;

export function warmUpDeviceVoice(): Promise<void> {
  if (deviceVoiceWarmUp) return deviceVoiceWarmUp;
  const startedAtMs = Date.now();
  deviceVoiceWarmUp = Speech.getAvailableVoicesAsync()
    .then((voices) => {
      console.log(`[speech] device voice warm in ${Date.now() - startedAtMs}ms (${voices.length} voices)`);
    })
    .catch((error: unknown) => {
      deviceVoiceWarmUp = null;
      console.warn('[speech] device voice warm-up failed', error);
    });
  return deviceVoiceWarmUp;
}

/**
 * Fetches Google audio for sentences that are about to be spoken (see
 * speech/predictAnnouncement.ts). Skipped while Google is in its failure
 * cooldown, since speakAsync won't use Google then anyway.
 */
export function prefetchSpeech(texts: string[]): void {
  if (texts.length === 0 || Date.now() < googleTtsRetryAtMs) return;
  for (const text of texts) prefetchTtsAudio(text);
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
