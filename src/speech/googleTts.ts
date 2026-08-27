import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { env } from '../config/env';

/**
 * Google's current flagship "Chirp3 HD" tier - Australian English, verified
 * live against the real API while planning this (GET /v1/voices and a real
 * /v1/text:synthesize call both confirmed against the user's own GCP
 * project, not assumed from docs).
 */
const GOOGLE_TTS_LANGUAGE_CODE = 'en-AU';
const GOOGLE_TTS_VOICE_NAME = 'en-AU-Chirp3-HD-Charon';

async function fetchAudioDataUri(text: string, signal: AbortSignal): Promise<string> {
  if (!env.googleTtsApiKey) {
    throw new Error('EXPO_PUBLIC_GOOGLE_TTS_API_KEY is not set');
  }

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.googleTtsApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: GOOGLE_TTS_LANGUAGE_CODE, name: GOOGLE_TTS_VOICE_NAME },
        audioConfig: { audioEncoding: 'MP3' },
      }),
      signal,
    }
  );

  if (!response.ok) {
    throw new Error(`Google TTS request failed with status ${response.status}`);
  }

  // Unlike ElevenLabs (raw binary, needing a hand-rolled base64 encode -
  // Hermes has no btoa), Google's response is already a base64 JSON string.
  const { audioContent } = (await response.json()) as { audioContent: string };
  return `data:audio/mp3;base64,${audioContent}`;
}

export interface GoogleTtsSpeakOptions {
  rate?: number;
  volume?: number;
}

/**
 * Bumped on every speakWithGoogleTtsAsync()/stopGoogleTtsSpeech() call -
 * lets a stop() that arrives while a fetch is still in flight (or after
 * playback already moved on to a newer utterance) invalidate the stale
 * one's callbacks instead of having them resolve/reject a promise nobody
 * is waiting on anymore.
 */
let currentUtteranceId = 0;
let activePlayer: AudioPlayer | null = null;
let activeAbortController: AbortController | null = null;
/** The pending call's own resolve - stopGoogleTtsSpeech() invokes this
 * directly, since tearing down the player doesn't by itself guarantee a
 * final playbackStatusUpdate event (e.g. after pause()+remove()) that
 * would otherwise be the only thing settling the promise. */
let activeResolve: (() => void) | null = null;
let activeTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Safety net for the whole fetch+playback round trip. A driving-safety
 * announcement is a short sentence - a couple of seconds of audio plus a
 * fast fetch - so a request still outstanding this long is stuck, not just
 * slow: a fetch with no server response (no timeout of its own otherwise),
 * or a playbackStatusUpdate that never arrives. Without this, ttsAdapter's
 * on-device fallback only triggers on an explicit rejection, so a hang
 * here would silently block every later announcement forever - tick()
 * awaits this promise before dequeuing the next alert.
 */
const OVERALL_TIMEOUT_MS = 20_000;

function releaseActivePlayer(): void {
  if (activePlayer) {
    activePlayer.remove();
    activePlayer = null;
  }
}

function clearActiveTimeout(): void {
  if (activeTimeoutId !== null) {
    clearTimeout(activeTimeoutId);
    activeTimeoutId = null;
  }
}

/**
 * Fetches speech audio from Google Cloud Text-to-Speech and plays it,
 * resolving once playback finishes - naturally, or because
 * stopGoogleTtsSpeech() cut it off (matching expo-speech's onStopped ->
 * resolve, not reject). Rejects only on a genuine failure (network/API
 * error, player error) - the caller (ttsAdapter.ts) falls back to the
 * on-device voice when that happens, so a network hiccup never means the
 * driver hears nothing.
 *
 * Self-preempting: calling this while a previous call is still in flight
 * (fetching or playing) - e.g. tripRuntime.ts's speed-camera warning
 * (which bypasses the announcer's priority queue and calls speakAsync
 * directly) firing while the live announcer queue is mid-utterance, or
 * vice versa - stops that previous call first, exactly as if stopSpeaking()
 * had been called on it (its promise resolves, not hangs). Without this,
 * a second concurrent caller would just bump currentUtteranceId out from
 * under the first one without settling it, leaving the first call's
 * awaiter (tick(), with isSpeaking stuck true) blocked forever - the
 * live announcement queue could never recover, since nothing else here
 * calls that first call's resolve.
 */
export function speakWithGoogleTtsAsync(text: string, options: GoogleTtsSpeakOptions = {}): Promise<void> {
  stopGoogleTtsSpeech();
  const utteranceId = ++currentUtteranceId;
  const isCurrent = () => utteranceId === currentUtteranceId;

  const abortController = new AbortController();
  activeAbortController = abortController;

  return new Promise((resolve, reject) => {
    activeResolve = resolve;

    // This call's own timer, cleared directly (never via the shared
    // activeTimeoutId, which a newer utterance may have already
    // overwritten with its own watchdog by the time a stale settle runs -
    // see the activeTimeoutId-clearing guard below).
    const timeoutId = setTimeout(() => {
      if (!isCurrent()) return;
      // Bump the id, same as stopGoogleTtsSpeech - without this, a fetch
      // that was hung but eventually resolves after this timeout has
      // already rejected (and ttsAdapter has already started the device
      // fallback) would still pass isCurrent() and go on to create a
      // player and play, overlapping the fallback voice.
      currentUtteranceId += 1;
      abortController.abort();
      if (activePlayer) {
        activePlayer.pause();
      }
      releaseActivePlayer();
      settleReject(new Error('Google TTS timed out'));
    }, OVERALL_TIMEOUT_MS);
    activeTimeoutId = timeoutId;

    const settleResolve = () => {
      clearTimeout(timeoutId);
      if (activeTimeoutId === timeoutId) activeTimeoutId = null;
      if (activeResolve === resolve) activeResolve = null;
      resolve();
    };
    const settleReject = (error: Error) => {
      clearTimeout(timeoutId);
      if (activeTimeoutId === timeoutId) activeTimeoutId = null;
      if (activeResolve === resolve) activeResolve = null;
      reject(error);
    };

    fetchAudioDataUri(text, abortController.signal)
      .then((dataUri) => {
        if (!isCurrent()) {
          settleResolve(); // stopped while the fetch was still in flight
          return;
        }

        const player = createAudioPlayer({ uri: dataUri });
        activePlayer = player;
        player.volume = options.volume ?? 1;
        if (options.rate !== undefined) {
          // Not `player.playbackRate = options.rate` - on-device, that
          // throws "Cannot assign to property 'playbackRate' which has
          // only a getter" despite the type declarations documenting it
          // as a plain settable property. setPlaybackRate() is the real,
          // working native API for this.
          player.setPlaybackRate(options.rate);
        }

        const subscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
          if (!isCurrent()) return;

          if (status.error) {
            subscription.remove();
            releaseActivePlayer();
            settleReject(new Error(status.error));
            return;
          }
          if (status.didJustFinish) {
            subscription.remove();
            releaseActivePlayer();
            settleResolve();
          }
        });

        player.play();
      })
      .catch((error) => {
        if (!isCurrent()) {
          settleResolve(); // stopped/aborted while the fetch was still in flight
          return;
        }
        settleReject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

/** Cuts off whatever speakWithGoogleTtsAsync() call is currently in
 * flight - fetching or playing - resolving its promise directly (tearing
 * down the player doesn't by itself guarantee a final status event) so
 * it settles instead of hanging, and invalidating it so any callback
 * that does still land afterward is a no-op. */
export function stopGoogleTtsSpeech(): void {
  currentUtteranceId += 1;
  clearActiveTimeout();
  activeAbortController?.abort();
  activeAbortController = null;
  if (activePlayer) {
    activePlayer.pause();
  }
  releaseActivePlayer();
  activeResolve?.();
  activeResolve = null;
}
