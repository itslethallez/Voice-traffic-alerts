type StatusListener = (status: { error: string | null; didJustFinish: boolean }) => void;

interface MockPlayer {
  volume: number;
  play: jest.Mock;
  pause: jest.Mock;
  remove: jest.Mock;
  addListener: jest.Mock;
  setPlaybackRate: jest.Mock;
  emitStatus: (status: { error?: string | null; didJustFinish?: boolean }) => void;
}

/**
 * No plain `playbackRate` property - the real native player only exposes
 * a getter for it (assigning throws "Cannot assign to property
 * 'playbackRate' which has only a getter" on-device, despite what the
 * type declarations claim). setPlaybackRate() is the real, working API,
 * so that's what the mock exposes too - matching a plain settable
 * property here would have hidden the exact bug this shape caught.
 */
function createMockPlayer(): MockPlayer {
  let listener: StatusListener | null = null;
  const player: MockPlayer = {
    volume: 1,
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    addListener: jest.fn((_event: string, cb: StatusListener) => {
      listener = cb;
      return { remove: jest.fn() };
    }),
    setPlaybackRate: jest.fn(),
    emitStatus: (status) => {
      listener?.({ error: null, didJustFinish: false, ...status });
    },
  };
  return player;
}

let mockPlayer: MockPlayer;
const createAudioPlayer = jest.fn((..._args: unknown[]) => mockPlayer);

jest.mock('expo-audio', () => ({
  createAudioPlayer: (...args: unknown[]) => createAudioPlayer(...args),
}));

let googleTtsApiKey = 'test-key';
jest.mock('../../config/env', () => ({
  get env() {
    return { googleTtsApiKey };
  },
}));

import { GoogleTtsNotReadyError, speakWithGoogleTtsAsync, stopGoogleTtsSpeech } from '../googleTts';
import { clearTtsAudioCache, prefetchTtsAudio } from '../ttsAudioCache';

/** Lets the fetch -> audio-cache -> createAudioPlayer promise chain run to
 * completion without the test depending on its exact number of hops. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function makeFetchResponse(ok: boolean, status = 200): Response {
  return {
    ok,
    status,
    json: async () => ({ audioContent: 'AAECAwQ=' }),
  } as unknown as Response;
}

describe('speakWithGoogleTtsAsync', () => {
  beforeEach(() => {
    clearTtsAudioCache();
    googleTtsApiKey = 'test-key';
    mockPlayer = createMockPlayer();
    createAudioPlayer.mockClear();
    globalThis.fetch = jest.fn();
  });

  it('fetches audio, plays it, and resolves when playback finishes', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

    const promise = speakWithGoogleTtsAsync('Police reported, 800 metres ahead.');
    // Let the fetch/createAudioPlayer microtasks settle before emitting.
    await flushMicrotasks();
    mockPlayer.emitStatus({ didJustFinish: true });

    await expect(promise).resolves.toBeUndefined();
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
  });

  it('sends the text, API key, and voice in the request', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

    const promise = speakWithGoogleTtsAsync('hello');
    await flushMicrotasks();
    mockPlayer.emitStatus({ didJustFinish: true });
    await promise;

    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize?key=test-key');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.input.text).toBe('hello');
    expect(body.voice).toEqual({ languageCode: 'en-GB', name: 'en-GB-Chirp3-HD-Kore' });
  });

  it('applies volume and rate to the player before playing', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

    const promise = speakWithGoogleTtsAsync('hello', { volume: 0.6, rate: 1.4 });
    await flushMicrotasks();
    expect(mockPlayer.volume).toBe(0.6);
    expect(mockPlayer.setPlaybackRate).toHaveBeenCalledWith(1.4);
    mockPlayer.emitStatus({ didJustFinish: true });
    await promise;
  });

  it('rejects without touching the device fallback when the API key is missing', async () => {
    googleTtsApiKey = '';
    await expect(speakWithGoogleTtsAsync('hello')).rejects.toThrow(
      'EXPO_PUBLIC_GOOGLE_TTS_API_KEY is not set'
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects when the fetch response is not ok', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(false, 429));
    await expect(speakWithGoogleTtsAsync('hello')).rejects.toThrow(
      'Google TTS request failed with status 429'
    );
  });

  it('rejects when the network request itself throws', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
    await expect(speakWithGoogleTtsAsync('hello')).rejects.toThrow('network down');
  });

  it('rejects when the player reports a playback error', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

    const promise = speakWithGoogleTtsAsync('hello');
    await flushMicrotasks();
    mockPlayer.emitStatus({ error: 'decode failed' });

    await expect(promise).rejects.toThrow('decode failed');
    expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
  });

  it('resolves (does not reject) when stopped while audio is already playing', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

    const promise = speakWithGoogleTtsAsync('hello');
    await flushMicrotasks();
    stopGoogleTtsSpeech();

    await expect(promise).resolves.toBeUndefined();
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
    expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
  });

  it('resolves (does not reject) when stopped while the fetch is still in flight', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    (globalThis.fetch as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    const promise = speakWithGoogleTtsAsync('hello');
    stopGoogleTtsSpeech();
    resolveFetch(makeFetchResponse(true));

    await expect(promise).resolves.toBeUndefined();
    // Stopped before the player was ever created - nothing to play.
    expect(createAudioPlayer).not.toHaveBeenCalled();
  });

  it('rejects (falling back to the device voice) when the fetch hangs past the overall timeout', async () => {
    jest.useFakeTimers();
    try {
      (globalThis.fetch as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves

      const promise = speakWithGoogleTtsAsync('hello');
      const expectation = expect(promise).rejects.toThrow('Google TTS timed out');
      await jest.advanceTimersByTimeAsync(20_000);
      await expectation;

      expect(createAudioPlayer).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects (falling back to the device voice) when playback never reports didJustFinish', async () => {
    jest.useFakeTimers();
    try {
      (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

      const promise = speakWithGoogleTtsAsync('hello');
      const expectation = expect(promise).rejects.toThrow('Google TTS timed out');
      // Let the fetch .then() microtask create the player before the clock advances.
      await flushMicrotasks();
      await jest.advanceTimersByTimeAsync(20_000);
      await expectation;

      expect(mockPlayer.play).toHaveBeenCalledTimes(1);
      expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
      expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('preempts (resolves, not hangs) an in-flight call when a second one starts with no explicit stop', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

    // No stopGoogleTtsSpeech() call in between - this is the shape of the
    // speed-camera warning racing the live announcer queue, which has no
    // reason to know about (or call stop on behalf of) the other caller.
    const first = speakWithGoogleTtsAsync('first');
    await flushMicrotasks();

    const second = speakWithGoogleTtsAsync('second');

    await expect(first).resolves.toBeUndefined();
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
    expect(mockPlayer.remove).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    mockPlayer.emitStatus({ didJustFinish: true });

    await expect(second).resolves.toBeUndefined();
  });

  it('invalidates the utterance on timeout, so a hung fetch that resolves late never creates a player', async () => {
    jest.useFakeTimers();
    try {
      let resolveFetch: (value: Response) => void = () => {};
      (globalThis.fetch as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      );

      const promise = speakWithGoogleTtsAsync('hello');
      const expectation = expect(promise).rejects.toThrow('Google TTS timed out');
      await jest.advanceTimersByTimeAsync(20_000);
      await expectation;

      // The fetch was hung, not actually dead - it "arrives" after the
      // timeout already rejected and ttsAdapter has already started the
      // device fallback. It must not go on to create/play a player, which
      // would overlap the fallback voice.
      resolveFetch(makeFetchResponse(true));
      await flushMicrotasks();

      expect(createAudioPlayer).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a stale timeout settle does not wipe a newer utterance\'s own watchdog', async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = globalThis.fetch as jest.Mock;
      let resolveFirstFetch: (value: Response) => void = () => {};
      fetchMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstFetch = resolve;
          })
      );
      fetchMock.mockImplementationOnce(() => new Promise(() => {})); // second utterance hangs too

      const first = speakWithGoogleTtsAsync('first');
      const firstExpectation = expect(first).rejects.toThrow('Google TTS timed out');
      await jest.advanceTimersByTimeAsync(20_000); // first's own watchdog fires
      await firstExpectation;

      const second = speakWithGoogleTtsAsync('second');
      const secondExpectation = expect(second).rejects.toThrow('Google TTS timed out');

      // The first request was hung, not dead - it "arrives" now, well
      // after its own timeout already rejected, and while the second
      // utterance's own watchdog is still running. A shared (not
      // per-utterance) timer slot would let this stale settle wipe the
      // second utterance's watchdog instead of just its own.
      resolveFirstFetch(makeFetchResponse(true));
      await flushMicrotasks();

      // The second utterance's own watchdog must still be armed.
      await jest.advanceTimersByTimeAsync(20_000);
      await secondExpectation;
    } finally {
      jest.useRealTimers();
    }
  });

  it('a stale utterance stopped mid-flight does not resolve a newer one early', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

    const stale = speakWithGoogleTtsAsync('first');
    stopGoogleTtsSpeech();
    const fresh = speakWithGoogleTtsAsync('second');

    await expect(stale).resolves.toBeUndefined();

    await flushMicrotasks();
    mockPlayer.emitStatus({ didJustFinish: true });

    await expect(fresh).resolves.toBeUndefined();
  });

  describe('ready deadline (native XHR timeout)', () => {
    /** Minimal XMLHttpRequest stand-in: the test drives load/timeout. */
    class FakeXhr {
      static last: FakeXhr | null = null;
      timeout = 0;
      status = 0;
      responseText = '';
      body: string | null = null;
      onload: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      aborted = false;
      open = jest.fn();
      setRequestHeader = jest.fn();
      send(body: string) {
        this.body = body;
        FakeXhr.last = this;
      }
      abort() {
        this.aborted = true;
        this.onabort?.();
      }
      respond() {
        this.status = 200;
        this.responseText = JSON.stringify({ audioContent: 'AAECAwQ=' });
        this.onload?.();
      }
    }

    beforeEach(() => {
      FakeXhr.last = null;
      (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
    });

    it('hands the deadline to the native request timeout, not a JS timer', async () => {
      const promise = speakWithGoogleTtsAsync('hello', { readyDeadlineMs: 600 });
      expect(FakeXhr.last?.timeout).toBe(600);
      expect(JSON.parse(FakeXhr.last?.body ?? '{}').input.text).toBe('hello');
      FakeXhr.last?.respond();
      await flushMicrotasks();
      mockPlayer.emitStatus({ didJustFinish: true });
      await expect(promise).resolves.toBeUndefined();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('rejects with GoogleTtsNotReadyError when the native timeout fires, and never plays', async () => {
      const promise = speakWithGoogleTtsAsync('slow', { readyDeadlineMs: 600 });
      FakeXhr.last?.ontimeout?.();
      await expect(promise).rejects.toBeInstanceOf(GoogleTtsNotReadyError);
      expect(createAudioPlayer).not.toHaveBeenCalled();
    });

    it('treats an XHR error arriving at the deadline as not-ready (RN reports callTimeout as onerror)', async () => {
      const nowSpy = jest.spyOn(Date, 'now');
      const t0 = Date.now();
      nowSpy.mockReturnValue(t0);
      const promise = speakWithGoogleTtsAsync('slow', { readyDeadlineMs: 600 });
      nowSpy.mockReturnValue(t0 + 612);
      FakeXhr.last?.onerror?.();
      await expect(promise).rejects.toBeInstanceOf(GoogleTtsNotReadyError);
      nowSpy.mockRestore();
    });

    it('still treats a fast XHR error as a real failure', async () => {
      const promise = speakWithGoogleTtsAsync('offline', { readyDeadlineMs: 600 });
      FakeXhr.last?.onerror?.();
      await expect(promise).rejects.toThrow('network error');
    });

    it('uses a prefetch already in flight if it lands first, and cancels its own request', async () => {
      // Prefetches go through the native-timeout XHR too: two requests.
      prefetchTtsAudio('racing');
      const prefetch = FakeXhr.last;

      const promise = speakWithGoogleTtsAsync('racing', { readyDeadlineMs: 600 });
      const own = FakeXhr.last;
      expect(own).not.toBe(prefetch);
      prefetch?.respond();
      await flushMicrotasks();
      mockPlayer.emitStatus({ didJustFinish: true });

      await expect(promise).resolves.toBeUndefined();
      expect(own?.aborted).toBe(true);
    });

    it('still gives up at the deadline while a slower prefetch is in flight', async () => {
      prefetchTtsAudio('racing'); // its XHR never answers

      const promise = speakWithGoogleTtsAsync('racing', { readyDeadlineMs: 600 });
      FakeXhr.last?.ontimeout?.();

      await expect(promise).rejects.toBeInstanceOf(GoogleTtsNotReadyError);
    });
  });
});
