type StatusListener = (status: { error: string | null; didJustFinish: boolean }) => void;

interface MockPlayer {
  volume: number;
  playbackRate: number;
  play: jest.Mock;
  pause: jest.Mock;
  remove: jest.Mock;
  addListener: jest.Mock;
  emitStatus: (status: { error?: string | null; didJustFinish?: boolean }) => void;
}

function createMockPlayer(): MockPlayer {
  let listener: StatusListener | null = null;
  const player: MockPlayer = {
    volume: 1,
    playbackRate: 1,
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    addListener: jest.fn((_event: string, cb: StatusListener) => {
      listener = cb;
      return { remove: jest.fn() };
    }),
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

let elevenLabsApiKey = 'test-key';
jest.mock('../../config/env', () => ({
  get env() {
    return { elevenLabsApiKey };
  },
}));

import { speakWithElevenLabsAsync, stopElevenLabsSpeech } from '../elevenLabsTts';

function makeFetchResponse(ok: boolean, status = 200): Response {
  return {
    ok,
    status,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer,
  } as unknown as Response;
}

describe('speakWithElevenLabsAsync', () => {
  beforeEach(() => {
    elevenLabsApiKey = 'test-key';
    mockPlayer = createMockPlayer();
    createAudioPlayer.mockClear();
    globalThis.fetch = jest.fn();
  });

  it('fetches audio, plays it, and resolves when playback finishes', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

    const promise = speakWithElevenLabsAsync('Police reported, 800 metres ahead.');
    // Let the fetch/createAudioPlayer microtasks settle before emitting.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    mockPlayer.emitStatus({ didJustFinish: true });

    await expect(promise).resolves.toBeUndefined();
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
  });

  it('sends the text, xi-api-key header, and voice ID in the request', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

    const promise = speakWithElevenLabsAsync('hello');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    mockPlayer.emitStatus({ didJustFinish: true });
    await promise;

    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/mu0IU3jf7cZMIxETkI0n');
    expect(init.method).toBe('POST');
    expect(init.headers['xi-api-key']).toBe('test-key');
    expect(JSON.parse(init.body).text).toBe('hello');
  });

  it('applies volume and rate to the player before playing', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

    const promise = speakWithElevenLabsAsync('hello', { volume: 0.6, rate: 1.4 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockPlayer.volume).toBe(0.6);
    expect(mockPlayer.playbackRate).toBe(1.4);
    mockPlayer.emitStatus({ didJustFinish: true });
    await promise;
  });

  it('rejects without touching the device fallback when the API key is missing', async () => {
    elevenLabsApiKey = '';
    await expect(speakWithElevenLabsAsync('hello')).rejects.toThrow(
      'EXPO_PUBLIC_ELEVENLABS_API_KEY is not set'
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects when the fetch response is not ok', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(false, 429));
    await expect(speakWithElevenLabsAsync('hello')).rejects.toThrow(
      'ElevenLabs TTS request failed with status 429'
    );
  });

  it('rejects when the network request itself throws', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
    await expect(speakWithElevenLabsAsync('hello')).rejects.toThrow('network down');
  });

  it('rejects when the player reports a playback error', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

    const promise = speakWithElevenLabsAsync('hello');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    mockPlayer.emitStatus({ error: 'decode failed' });

    await expect(promise).rejects.toThrow('decode failed');
    expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
  });

  it('resolves (does not reject) when stopped while audio is already playing', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

    const promise = speakWithElevenLabsAsync('hello');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    stopElevenLabsSpeech();

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

    const promise = speakWithElevenLabsAsync('hello');
    stopElevenLabsSpeech();
    resolveFetch(makeFetchResponse(true));

    await expect(promise).resolves.toBeUndefined();
    // Stopped before the player was ever created - nothing to play.
    expect(createAudioPlayer).not.toHaveBeenCalled();
  });

  it('rejects (falling back to the device voice) when the fetch hangs past the overall timeout', async () => {
    jest.useFakeTimers();
    try {
      (globalThis.fetch as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves

      const promise = speakWithElevenLabsAsync('hello');
      const expectation = expect(promise).rejects.toThrow('ElevenLabs TTS timed out');
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

      const promise = speakWithElevenLabsAsync('hello');
      const expectation = expect(promise).rejects.toThrow('ElevenLabs TTS timed out');
      // Let the fetch .then() microtask create the player before the clock advances.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(20_000);
      await expectation;

      expect(mockPlayer.play).toHaveBeenCalledTimes(1);
      expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
      expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a stale utterance stopped mid-flight does not resolve a newer one early', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true));

    const stale = speakWithElevenLabsAsync('first');
    stopElevenLabsSpeech();
    const fresh = speakWithElevenLabsAsync('second');

    await expect(stale).resolves.toBeUndefined();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    mockPlayer.emitStatus({ didJustFinish: true });

    await expect(fresh).resolves.toBeUndefined();
  });
});
