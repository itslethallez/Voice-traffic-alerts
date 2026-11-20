let googleTtsApiKey = 'test-key';
jest.mock('../../config/env', () => ({
  get env() {
    return { googleTtsApiKey };
  },
}));

import {
  clearTtsAudioCache,
  getAudioDataUri,
  prefetchTtsAudio,
  TTS_AUDIO_CACHE_MAX_ENTRIES,
} from '../ttsAudioCache';

function okResponse(audioContent = 'AAEC'): Response {
  return { ok: true, status: 200, json: async () => ({ audioContent }) } as unknown as Response;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const signal = () => new AbortController().signal;

describe('ttsAudioCache', () => {
  beforeEach(() => {
    clearTtsAudioCache();
    googleTtsApiKey = 'test-key';
    globalThis.fetch = jest.fn().mockResolvedValue(okResponse());
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches from the network on a cold miss, then serves the same text from cache', async () => {
    const first = await getAudioDataUri('Hazard 2 kilometres ahead.', signal());
    const second = await getAudioDataUri('Hazard 2 kilometres ahead.', signal());

    expect(first).toEqual({ dataUri: 'data:audio/mp3;base64,AAEC', source: 'network' });
    expect(second.source).toBe('cache');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('a completed prefetch makes the later speak a cache hit with no second request', async () => {
    prefetchTtsAudio('Hazard 2 kilometres ahead.');
    await flushMicrotasks();

    const audio = await getAudioDataUri('Hazard 2 kilometres ahead.', signal());

    expect(audio.source).toBe('cache');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('a speak that arrives while its prefetch is still in flight joins it instead of fetching again', async () => {
    let resolveFetch: (r: Response) => void = () => {};
    (globalThis.fetch as jest.Mock).mockReturnValueOnce(new Promise<Response>((r) => (resolveFetch = r)));

    prefetchTtsAudio('Hazard 2 kilometres ahead.');
    const speaking = getAudioDataUri('Hazard 2 kilometres ahead.', signal());
    resolveFetch(okResponse('Zm9v'));

    await expect(speaking).resolves.toEqual({ dataUri: 'data:audio/mp3;base64,Zm9v', source: 'prefetch' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('a failed prefetch falls through to a fresh fetch rather than failing the utterance', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    prefetchTtsAudio('Hazard 2 kilometres ahead.');
    const audio = await getAudioDataUri('Hazard 2 kilometres ahead.', signal());

    expect(audio.source).toBe('network');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('never caches a failure - the next attempt goes back to the network', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    prefetchTtsAudio('Hazard 2 kilometres ahead.');
    await flushMicrotasks();

    prefetchTtsAudio('Hazard 2 kilometres ahead.');
    await flushMicrotasks();

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    await expect(getAudioDataUri('Hazard 2 kilometres ahead.', signal())).resolves.toMatchObject({ source: 'cache' });
  });

  it('does not start a duplicate prefetch for text already cached or in flight', async () => {
    prefetchTtsAudio('a');
    prefetchTtsAudio('a');
    await flushMicrotasks();
    prefetchTtsAudio('a');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an API key (speakAsync will fall back to the device voice anyway)', () => {
    googleTtsApiKey = '';
    prefetchTtsAudio('a');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('evicts the least recently used clip once full', async () => {
    for (let i = 0; i <= TTS_AUDIO_CACHE_MAX_ENTRIES; i++) {
      await getAudioDataUri(`clip ${i}`, signal());
    }
    (globalThis.fetch as jest.Mock).mockClear();

    await expect(getAudioDataUri('clip 0', signal())).resolves.toMatchObject({ source: 'network' });
    await expect(getAudioDataUri(`clip ${TTS_AUDIO_CACHE_MAX_ENTRIES}`, signal())).resolves.toMatchObject({
      source: 'cache',
    });
  });
});
