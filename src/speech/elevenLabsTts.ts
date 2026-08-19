import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { env } from '../config/env';

const ELEVENLABS_VOICE_ID = 'mu0IU3jf7cZMIxETkI0n';
/**
 * ElevenLabs' lowest-latency model. The whole point of speaking an alert
 * out loud is minimizing the gap between "alert became announceable" and
 * "driver heard it" - a slower, higher-fidelity model isn't worth that
 * delay for short safety announcements.
 */
const ELEVENLABS_MODEL_ID = 'eleven_flash_v2_5';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Hermes doesn't ship btoa, and pulling in expo-file-system just to write
 * a temp file - when the player can take a data: URI directly - isn't
 * worth another native dependency and another native rebuild.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    result += b1 === undefined ? '=' : BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    result += b2 === undefined ? '=' : BASE64_CHARS[b2 & 0x3f];
  }
  return result;
}

async function fetchAudioDataUri(text: string, signal: AbortSignal): Promise<string> {
  if (!env.elevenLabsApiKey) {
    throw new Error('EXPO_PUBLIC_ELEVENLABS_API_KEY is not set');
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': env.elevenLabsApiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL_ID }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS request failed with status ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return `data:audio/mpeg;base64,${bytesToBase64(new Uint8Array(arrayBuffer))}`;
}

export interface ElevenLabsSpeakOptions {
  rate?: number;
  volume?: number;
}

/**
 * Bumped on every speakWithElevenLabsAsync()/stopElevenLabsSpeech() call -
 * lets a stop() that arrives while a fetch is still in flight (or after
 * playback already moved on to a newer utterance) invalidate the stale
 * one's callbacks instead of having them resolve/reject a promise nobody
 * is waiting on anymore.
 */
let currentUtteranceId = 0;
let activePlayer: AudioPlayer | null = null;
let activeAbortController: AbortController | null = null;
/** The pending call's own resolve - stopElevenLabsSpeech() invokes this
 * directly, since tearing down the player doesn't by itself guarantee a
 * final playbackStatusUpdate event (e.g. after pause()+remove()) that
 * would otherwise be the only thing settling the promise. */
let activeResolve: (() => void) | null = null;
let activeTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Safety net for the whole fetch+playback round trip. A driving-safety
 * announcement is a short sentence - a couple of seconds of audio plus a
 * fast Flash-model fetch - so a request still outstanding this long is
 * stuck, not just slow: a fetch with no server response (no timeout of
 * its own otherwise), or a playbackStatusUpdate that never arrives.
 * Without this, ttsAdapter's on-device fallback only triggers on an
 * explicit rejection, so a hang here would silently block every later
 * announcement forever - tick() awaits this promise before dequeuing the
 * next alert.
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
 * Fetches speech audio from ElevenLabs and plays it, resolving once
 * playback finishes - naturally, or because stopElevenLabsSpeech() cut it
 * off (matching expo-speech's onStopped -> resolve, not reject). Rejects
 * only on a genuine failure (network/API error, player error) - the
 * caller (ttsAdapter.ts) falls back to the on-device voice when that
 * happens, so a network hiccup never means the driver hears nothing.
 */
export function speakWithElevenLabsAsync(text: string, options: ElevenLabsSpeakOptions = {}): Promise<void> {
  const utteranceId = ++currentUtteranceId;
  const isCurrent = () => utteranceId === currentUtteranceId;

  const abortController = new AbortController();
  activeAbortController = abortController;

  return new Promise((resolve, reject) => {
    activeResolve = resolve;

    const settleResolve = () => {
      clearActiveTimeout();
      if (activeResolve === resolve) activeResolve = null;
      resolve();
    };
    const settleReject = (error: Error) => {
      clearActiveTimeout();
      if (activeResolve === resolve) activeResolve = null;
      reject(error);
    };

    activeTimeoutId = setTimeout(() => {
      if (!isCurrent()) return;
      abortController.abort();
      if (activePlayer) {
        activePlayer.pause();
      }
      releaseActivePlayer();
      settleReject(new Error('ElevenLabs TTS timed out'));
    }, OVERALL_TIMEOUT_MS);

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
          player.playbackRate = options.rate;
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

/** Cuts off whatever speakWithElevenLabsAsync() call is currently in
 * flight - fetching or playing - resolving its promise directly (tearing
 * down the player doesn't by itself guarantee a final status event) so
 * it settles instead of hanging, and invalidating it so any callback
 * that does still land afterward is a no-op. */
export function stopElevenLabsSpeech(): void {
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
