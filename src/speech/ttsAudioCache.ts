import { requestJsonWithNativeTimeout, RequestTimeoutError } from '../api/nativeTimeoutRequest';
import { env } from '../config/env';

/**
 * Google Cloud TTS audio, fetched ahead of time and kept by exact text.
 *
 * The ~0.9s Google round-trip is the whole of the silence between "decided
 * to speak" and "first sound" (playback itself starts in ~30ms). If the
 * sentence is fetched while the alert is still waiting its turn in the
 * announcer queue, that silence disappears at dispatch. See
 * predictAnnouncement.ts for how the waiting sentence is predicted, and
 * trip/tripRuntime.ts for where prefetchTtsAudio() is called.
 *
 * Keyed by text alone: voice and language are fixed below, and rate/volume
 * are applied by the player at playback, not baked into the audio.
 *
 * Log tag: [ttsprefetch] - one line per prefetch start/ok/fail, so a drive
 * test's logcat shows how many fetches the prefetch cost and how many hit.
 */

/**
 * Google's current flagship "Chirp3 HD" tier - UK English, female, verified
 * live against the real API before wiring it in (GET /v1/voices and a real
 * /v1/text:synthesize call both confirmed against the user's own GCP
 * project, not assumed from docs). If a cheaper TTS provider swap happens
 * later, this voice preference (UK English, female, Chirp3 HD tier or
 * equivalent) should carry over rather than reset to whatever that
 * provider's own default is.
 */
const GOOGLE_TTS_LANGUAGE_CODE = 'en-GB';
const GOOGLE_TTS_VOICE_NAME = 'en-GB-Chirp3-HD-Kore';

/** A clip is ~12-33kB of base64; 24 of them is well under 1MB. Sized for
 * predictAnnouncement.ts's horizon: queue + approaching alerts, two
 * candidate sentences each, plus a briefing list. */
export const TTS_AUDIO_CACHE_MAX_ENTRIES = 24;

/** A prefetch that hasn't landed by now won't help - the alert's own
 * dispatch will have started its own fetch long before. */
export const TTS_PREFETCH_TIMEOUT_MS = 10_000;

export async function fetchAudioDataUri(text: string, signal: AbortSignal): Promise<string> {
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

/**
 * The audio wasn't ready within the caller's deadline. Distinct from a
 * failure: Google is fine, just not fast enough for this utterance, so
 * ttsAdapter speaks it on the device voice without entering the failure
 * cooldown.
 */
export class GoogleTtsNotReadyError extends Error {
  constructor(deadlineMs: number) {
    super(`Google TTS audio not ready within ${deadlineMs}ms`);
    this.name = 'GoogleTtsNotReadyError';
  }
}

/**
 * Google TTS synthesis with the timeout enforced natively
 * (XMLHttpRequest.timeout -> OkHttp callTimeout), not a JS timer - React
 * Native pauses JS timers whenever the app isn't in the foreground, so a
 * setTimeout deadline fired at 1446ms instead of 600ms on the drive test
 * that found this. See api/nativeTimeoutRequest.ts. A timeout rejects
 * with RequestTimeoutError.
 */
async function synthesizeWithin(text: string, timeoutMs: number, signal: AbortSignal): Promise<string> {
  if (!env.googleTtsApiKey) throw new Error('EXPO_PUBLIC_GOOGLE_TTS_API_KEY is not set');
  const { audioContent } = await requestJsonWithNativeTimeout<{ audioContent: string }>({
    method: 'POST',
    url: `https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.googleTtsApiKey}`,
    jsonBody: {
      input: { text },
      voice: { languageCode: GOOGLE_TTS_LANGUAGE_CODE, name: GOOGLE_TTS_VOICE_NAME },
      audioConfig: { audioEncoding: 'MP3' },
    },
    timeoutMs,
    signal,
  });
  return `data:audio/mp3;base64,${audioContent}`;
}

/** synthesizeWithin, with a timeout meaning "not ready in time". */
async function fetchAudioDataUriWithin(text: string, deadlineMs: number, signal: AbortSignal): Promise<string> {
  try {
    return await synthesizeWithin(text, deadlineMs, signal);
  } catch (error) {
    if (error instanceof RequestTimeoutError) throw new GoogleTtsNotReadyError(deadlineMs);
    throw error;
  }
}

/** Map iteration order is insertion order, so re-inserting on read makes
 * the first key the least recently used. */
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

function remember(text: string, dataUri: string): void {
  cache.delete(text);
  cache.set(text, dataUri);
  while (cache.size > TTS_AUDIO_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Starts fetching `text` in the background unless it's already cached or
 * already being fetched. Never rejects - a failed prefetch just means the
 * real dispatch fetches as it always did.
 */
export function prefetchTtsAudio(text: string): void {
  if (cache.has(text) || inFlight.has(text)) return;
  if (!env.googleTtsApiKey) return;

  const startedAtMs = Date.now();
  console.log(`[ttsprefetch] start "${text}"`);

  // Native timeout, not setTimeout+abort - the latter stalls in the
  // background (api/nativeTimeoutRequest.ts).
  const request = synthesizeWithin(text, TTS_PREFETCH_TIMEOUT_MS, new AbortController().signal)
    .then((dataUri) => {
      remember(text, dataUri);
      console.log(`[ttsprefetch] ok in ${Date.now() - startedAtMs}ms "${text}"`);
      return dataUri;
    })
    .finally(() => {
      inFlight.delete(text);
    });
  // The stored promise keeps its rejection for anyone who joins it (see
  // getAudioDataUri); this handler only stops an unjoined failure from
  // surfacing as an unhandled rejection.
  request.catch((error: unknown) => {
    console.log(
      `[ttsprefetch] failed after ${Date.now() - startedAtMs}ms "${text}": ${error instanceof Error ? error.message : String(error)}`
    );
  });
  inFlight.set(text, request);
}

export type TtsAudioSource = 'cache' | 'prefetch' | 'network';

export interface TtsAudio {
  dataUri: string;
  /** Where the audio came from - logged by googleTts.ts next to the
   * first-sound time, so a drive test shows which path each alert took. */
  source: TtsAudioSource;
}

/**
 * The audio for `text`: from the cache if it's there, by joining a
 * prefetch still in flight, or by fetching it now. A joined prefetch that
 * fails falls through to a fresh fetch rather than failing the utterance -
 * the prefetch has its own shorter timeout and shouldn't be what pushes
 * the driver onto the fallback voice.
 */
export async function getAudioDataUri(
  text: string,
  signal: AbortSignal,
  deadlineMs?: number
): Promise<TtsAudio> {
  const cached = cache.get(text);
  if (cached !== undefined) {
    remember(text, cached);
    return { dataUri: cached, source: 'cache' };
  }

  const pending = inFlight.get(text);
  if (deadlineMs !== undefined) return raceDeadline(text, pending, signal, deadlineMs);

  if (pending) {
    try {
      return { dataUri: await pending, source: 'prefetch' };
    } catch {
      // fall through to a fresh fetch below
    }
  }

  const dataUri = await fetchAudioDataUri(text, signal);
  remember(text, dataUri);
  return { dataUri, source: 'network' };
}

/**
 * With a deadline: a request of our own whose native timeout IS the
 * deadline, raced against any prefetch already in flight for the same
 * text. A prefetch can't carry this utterance's deadline (it started
 * earlier, with no timeout of its own that matches), so without the race a
 * joined prefetch could keep the driver waiting past it - at the cost of
 * one duplicate request, only when dispatch lands mid-prefetch.
 */
function raceDeadline(
  text: string,
  pending: Promise<string> | undefined,
  signal: AbortSignal,
  deadlineMs: number
): Promise<TtsAudio> {
  const own = new AbortController();
  const forwardAbort = () => own.abort();
  signal.addEventListener('abort', forwardAbort);

  return new Promise<TtsAudio>((resolve, reject) => {
    let settled = false;
    let pendingFailed = pending === undefined;
    let ownError: Error | null = null;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', forwardAbort);
      fn();
    };

    fetchAudioDataUriWithin(text, deadlineMs, own.signal).then(
      (dataUri) => {
        remember(text, dataUri);
        finish(() => resolve({ dataUri, source: 'network' }));
      },
      (error: Error) => {
        // The deadline passing ends the wait even if a prefetch is still
        // going; any other failure defers to the prefetch, if there is one.
        if (error instanceof GoogleTtsNotReadyError || pendingFailed) finish(() => reject(error));
        else ownError = error;
      }
    );

    pending?.then(
      (dataUri) =>
        finish(() => {
          own.abort();
          resolve({ dataUri, source: 'prefetch' });
        }),
      () => {
        pendingFailed = true;
        if (ownError) finish(() => reject(ownError));
      }
    );
  });
}

/** Test-only reset - the cache is module-level state shared across calls. */
export function clearTtsAudioCache(): void {
  cache.clear();
  inFlight.clear();
}
