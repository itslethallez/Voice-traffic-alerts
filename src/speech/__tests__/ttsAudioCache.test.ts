let googleTtsApiKey = 'test-key';
jest.mock('../../config/env', () => ({
  get env() {
    return { googleTtsApiKey };
  },
}));

import { FakeXhr, TTS_OK } from '../../test-utils/fakeXhr';
import {
  clearTtsAudioCache,
  getAudioDataUri,
  prefetchTtsAudio,
  TTS_AUDIO_CACHE_MAX_ENTRIES,
  TTS_PREFETCH_TIMEOUT_MS,
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
    FakeXhr.install();
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

  it('prefetches with the timeout enforced natively (XHR timeout), not a JS timer', () => {
    prefetchTtsAudio('a');
    expect(FakeXhr.last?.timeout).toBe(TTS_PREFETCH_TIMEOUT_MS);
    expect((FakeXhr.last?.jsonBody as { input: { text: string } }).input.text).toBe('a');
  });

  it('a completed prefetch makes the later speak a cache hit with no second request', async () => {
    prefetchTtsAudio('Hazard 2 kilometres ahead.');
    FakeXhr.last?.respond(TTS_OK);
    await flushMicrotasks();

    const audio = await getAudioDataUri('Hazard 2 kilometres ahead.', signal());

    expect(audio.source).toBe('cache');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('a speak that arrives while its prefetch is still in flight joins it instead of fetching again', async () => {
    prefetchTtsAudio('Hazard 2 kilometres ahead.');
    const speaking = getAudioDataUri('Hazard 2 kilometres ahead.', signal());
    FakeXhr.last?.respond({ audioContent: 'Zm9v' });

    await expect(speaking).resolves.toEqual({ dataUri: 'data:audio/mp3;base64,Zm9v', source: 'prefetch' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('a failed prefetch falls through to a fresh fetch rather than failing the utterance', async () => {
    prefetchTtsAudio('Hazard 2 kilometres ahead.');
    const speaking = getAudioDataUri('Hazard 2 kilometres ahead.', signal());
    FakeXhr.last?.fail();

    await expect(speaking).resolves.toMatchObject({ source: 'network' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('never caches a failure - the next attempt goes back to the network', async () => {
    prefetchTtsAudio('Hazard 2 kilometres ahead.');
    FakeXhr.last?.fail();
    await flushMicrotasks();

    prefetchTtsAudio('Hazard 2 kilometres ahead.');
    FakeXhr.last?.respond(TTS_OK);
    await flushMicrotasks();

    expect(FakeXhr.sent).toHaveLength(2);
    await expect(getAudioDataUri('Hazard 2 kilometres ahead.', signal())).resolves.toMatchObject({ source: 'cache' });
  });

  it('does not start a duplicate prefetch for text already cached or in flight', async () => {
    prefetchTtsAudio('a');
    prefetchTtsAudio('a');
    FakeXhr.last?.respond(TTS_OK);
    await flushMicrotasks();
    prefetchTtsAudio('a');

    expect(FakeXhr.sent).toHaveLength(1);
  });

  it('does nothing without an API key (speakAsync will fall back to the device voice anyway)', () => {
    googleTtsApiKey = '';
    prefetchTtsAudio('a');
    expect(FakeXhr.sent).toHaveLength(0);
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
