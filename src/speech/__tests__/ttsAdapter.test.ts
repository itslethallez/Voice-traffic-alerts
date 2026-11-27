type DeviceSpeakOptions = {
  rate?: number;
  volume?: number;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (error: Error) => void;
};

const speak = jest.fn<void, [string, DeviceSpeakOptions | undefined]>();
const stop = jest.fn().mockResolvedValue(undefined);
const getAvailableVoicesAsync = jest.fn().mockResolvedValue([{ identifier: 'v1' }]);

jest.mock('expo-speech', () => ({
  speak: (text: string, options?: DeviceSpeakOptions) => speak(text, options),
  stop: () => stop(),
  getAvailableVoicesAsync: () => getAvailableVoicesAsync(),
}));

const releaseAudioSessionAfterDeviceSpeech = jest.fn().mockResolvedValue(undefined);
jest.mock('../deviceVoiceSession', () => ({
  releaseAudioSessionAfterDeviceSpeech: () => releaseAudioSessionAfterDeviceSpeech(),
}));

const speakWithGoogleTtsAsync = jest.fn<Promise<void>, [string, Record<string, unknown>?]>();
const stopGoogleTtsSpeech = jest.fn();

class MockGoogleTtsNotReadyError extends Error {}
jest.mock('../googleTts', () => ({
  speakWithGoogleTtsAsync: (...args: [string, Record<string, unknown>?]) =>
    speakWithGoogleTtsAsync(...args),
  stopGoogleTtsSpeech: () => stopGoogleTtsSpeech(),
  GoogleTtsNotReadyError: MockGoogleTtsNotReadyError,
}));

const prefetchTtsAudio = jest.fn();
jest.mock('../ttsAudioCache', () => ({
  prefetchTtsAudio: (text: string) => prefetchTtsAudio(text),
}));

let phoneCallActive = false;
jest.mock('../callState', () => ({
  isPhoneCallActive: () => phoneCallActive,
}));

import { GOOGLE_TTS_RETRY_COOLDOWN_MS } from '../constants';
import type { getLastGoogleTtsError as GetLastGoogleTtsError, speakAsync as SpeakAsync, stopSpeaking as StopSpeaking } from '../ttsAdapter';

let speakAsync: typeof SpeakAsync;
let stopSpeaking: typeof StopSpeaking;
let getLastGoogleTtsError: typeof GetLastGoogleTtsError;

// A fresh module instance per test - ttsAdapter.ts tracks its Google TTS
// cooldown (see GOOGLE_TTS_RETRY_COOLDOWN_MS) and lastGoogleTtsError as
// module-level state with no reset hook of its own, so without this a
// cooldown set by one test would silently skip Google TTS in a later,
// unrelated test.
beforeEach(() => {
  speak.mockClear();
  stop.mockClear();
  speakWithGoogleTtsAsync.mockReset();
  stopGoogleTtsSpeech.mockReset();
  stop.mockReset().mockResolvedValue(undefined);
  phoneCallActive = false;
  jest.useRealTimers();
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ speakAsync, stopSpeaking, getLastGoogleTtsError } = require('../ttsAdapter'));
});

describe('speakAsync', () => {
  it('speaks via Google TTS and never touches the device voice when it succeeds', async () => {
    speakWithGoogleTtsAsync.mockResolvedValue(undefined);

    await speakAsync('Police reported, 800 metres ahead.', { rate: 1.1, volume: 0.8 });

    expect(speakWithGoogleTtsAsync).toHaveBeenCalledWith(
      'Police reported, 800 metres ahead.',
      { rate: 1.1, volume: 0.8, readyDeadlineMs: 2000 }
    );
    expect(speak).not.toHaveBeenCalled();
  });

  it('falls back to the on-device voice when Google TTS fails', async () => {
    speakWithGoogleTtsAsync.mockRejectedValue(new Error('Google TTS down'));
    speak.mockImplementation((_text, options) => options?.onDone?.());

    await speakAsync('hello', { rate: 1.1, volume: 0.8 });

    expect(speak).toHaveBeenCalledWith('hello', expect.objectContaining({ rate: 1.1, volume: 0.8 }));
  });

  it('resolves once the device fallback finishes (onDone)', async () => {
    speakWithGoogleTtsAsync.mockRejectedValue(new Error('Google TTS down'));
    speak.mockImplementation((_text, options) => options?.onDone?.());

    await expect(speakAsync('hello')).resolves.toBeUndefined();
  });

  it('hands the iOS audio session back after the device voice, so other audio un-ducks', async () => {
    releaseAudioSessionAfterDeviceSpeech.mockClear();
    speakWithGoogleTtsAsync.mockRejectedValue(new Error('Google TTS down'));
    speak.mockImplementation((_text, options) => options?.onDone?.());

    await speakAsync('hello');
    expect(releaseAudioSessionAfterDeviceSpeech).toHaveBeenCalledTimes(1);
  });

  it('resolves once the device fallback finishes (onStopped)', async () => {
    speakWithGoogleTtsAsync.mockRejectedValue(new Error('Google TTS down'));
    speak.mockImplementation((_text, options) => options?.onStopped?.());

    await expect(speakAsync('hello')).resolves.toBeUndefined();
  });

  it('rejects only once both Google TTS and the device fallback have failed', async () => {
    speakWithGoogleTtsAsync.mockRejectedValue(new Error('Google TTS down'));
    const deviceError = new Error('device tts failed too');
    speak.mockImplementation((_text, options) => options?.onError?.(deviceError));

    await expect(speakAsync('hello')).rejects.toThrow('device tts failed too');
  });

  it('rejects without touching either backend while a phone call is active', async () => {
    phoneCallActive = true;

    await expect(speakAsync('hello')).rejects.toThrow('Phone call in progress');

    expect(speakWithGoogleTtsAsync).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it('sticks with the device voice for a cooldown after a Google TTS failure, instead of retrying Google on every alert', async () => {
    speakWithGoogleTtsAsync.mockRejectedValueOnce(new Error('Google TTS down'));
    speak.mockImplementation((_text, options) => options?.onDone?.());

    await speakAsync('first alert');
    expect(speakWithGoogleTtsAsync).toHaveBeenCalledTimes(1);

    speakWithGoogleTtsAsync.mockClear();
    await speakAsync('second alert, moments later');

    // Still within the cooldown - never even attempted, so it can't flip
    // back to the Google voice for just one alert before failing again.
    expect(speakWithGoogleTtsAsync).not.toHaveBeenCalled();
    expect(speak).toHaveBeenCalledWith('second alert, moments later', expect.anything());
  });

  it('retries Google TTS again once the cooldown elapses', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(0);

    speakWithGoogleTtsAsync.mockRejectedValueOnce(new Error('Google TTS down'));
    speak.mockImplementation((_text, options) => options?.onDone?.());
    await speakAsync('first alert');

    jest.setSystemTime(GOOGLE_TTS_RETRY_COOLDOWN_MS + 1);
    speakWithGoogleTtsAsync.mockReset();
    speakWithGoogleTtsAsync.mockResolvedValueOnce(undefined);

    await speakAsync('an alert after the cooldown');

    expect(speakWithGoogleTtsAsync).toHaveBeenCalledWith('an alert after the cooldown', expect.anything());
  });
});

describe('getLastGoogleTtsError', () => {
  it('records the failure message when Google TTS falls back to the device voice', async () => {
    speakWithGoogleTtsAsync.mockRejectedValue(new Error('Google TTS request failed with status 401'));
    speak.mockImplementation((_text, options) => options?.onDone?.());

    await speakAsync('hello');

    expect(getLastGoogleTtsError()).toBe('Google TTS request failed with status 401');
  });

  it('clears back to null once a later call succeeds', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(0);

    speakWithGoogleTtsAsync.mockRejectedValueOnce(new Error('Google TTS request failed with status 401'));
    speak.mockImplementation((_text, options) => options?.onDone?.());
    await speakAsync('hello');
    expect(getLastGoogleTtsError()).not.toBeNull();

    // Past the post-failure cooldown, otherwise this next call would stick
    // with the device voice and never touch Google TTS at all.
    jest.setSystemTime(GOOGLE_TTS_RETRY_COOLDOWN_MS + 1);
    speakWithGoogleTtsAsync.mockResolvedValueOnce(undefined);
    await speakAsync('hello again');

    expect(getLastGoogleTtsError()).toBeNull();
  });
});

describe('stopSpeaking', () => {
  it('stops both the Google TTS and on-device backends unconditionally', async () => {
    await stopSpeaking();

    expect(stopGoogleTtsSpeech).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe('speakUrgentAsync', () => {
  let speakUrgentAsync: typeof import('../ttsAdapter').speakUrgentAsync;
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ speakUrgentAsync } = require('../ttsAdapter'));
  });

  it('speaks on the device voice first and never waits on Google', async () => {
    speak.mockImplementation((_text, options) => options?.onDone?.());

    await speakUrgentAsync('Speed camera 200 metres ahead.', { rate: 1.1, volume: 0.8 });

    expect(speak).toHaveBeenCalledWith(
      'Speed camera 200 metres ahead.',
      expect.objectContaining({ rate: 1.1, volume: 0.8 })
    );
    expect(speakWithGoogleTtsAsync).not.toHaveBeenCalled();
  });

  it('cuts off anything already speaking on either voice before it starts, instead of talking over it', async () => {
    const order: string[] = [];
    stopGoogleTtsSpeech.mockImplementation(() => order.push('stop google'));
    stop.mockImplementation(async () => {
      order.push('stop device');
    });
    speak.mockImplementation((_text, options) => {
      order.push('speak');
      options?.onDone?.();
    });

    await speakUrgentAsync('Speed camera 500 metres ahead.');

    expect(order).toEqual(['stop google', 'stop device', 'speak']);
  });

  it('falls back to Google when the device voice errors', async () => {
    speak.mockImplementation((_text, options) => options?.onError?.(new Error('no tts engine')));
    speakWithGoogleTtsAsync.mockResolvedValue(undefined);

    await speakUrgentAsync('Speed camera 500 metres ahead.');

    expect(speakWithGoogleTtsAsync).toHaveBeenCalledWith('Speed camera 500 metres ahead.', expect.anything());
  });

  it('rejects without speaking during a phone call, so the checkpoint stays unfired', async () => {
    phoneCallActive = true;

    await expect(speakUrgentAsync('Speed camera 500 metres ahead.')).rejects.toThrow('Phone call in progress');
    expect(speak).not.toHaveBeenCalled();
    expect(stopGoogleTtsSpeech).not.toHaveBeenCalled();
  });
});

describe('prefetchSpeech', () => {
  let prefetchSpeech: typeof import('../ttsAdapter').prefetchSpeech;
  beforeEach(() => {
    prefetchTtsAudio.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ prefetchSpeech, speakAsync } = require('../ttsAdapter'));
  });

  it('prefetches each predicted sentence', () => {
    prefetchSpeech(['a', 'b']);
    expect(prefetchTtsAudio.mock.calls).toEqual([['a'], ['b']]);
  });

  it('skips prefetching while Google is in its failure cooldown - it would not be used', async () => {
    speakWithGoogleTtsAsync.mockRejectedValueOnce(new Error('offline'));
    speak.mockImplementation((_text, options) => options?.onDone?.());
    await speakAsync('hello');

    prefetchSpeech(['a']);

    expect(prefetchTtsAudio).not.toHaveBeenCalled();
  });
});

describe('warmUpDeviceVoice', () => {
  let warmUpDeviceVoice: typeof import('../ttsAdapter').warmUpDeviceVoice;
  beforeEach(() => {
    getAvailableVoicesAsync.mockReset().mockResolvedValue([{ identifier: 'v1' }]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ warmUpDeviceVoice } = require('../ttsAdapter'));
  });

  it('binds the engine once, then loads the voice with one silent utterance', async () => {
    // The engine loads its voice model on first synthesis, not on bind -
    // so the warm-up speaks one word at volume 0 (fix 3, 20 Nov 2026).
    speak.mockImplementation((_text, options) => options?.onDone?.());
    await warmUpDeviceVoice();
    await warmUpDeviceVoice();

    expect(getAvailableVoicesAsync).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ volume: 0 }));
  });

  it('still finishes the warm-up if the silent utterance errors', async () => {
    speak.mockImplementation((_text, options) => options?.onError?.(new Error("tts")));
    await expect(warmUpDeviceVoice()).resolves.toBeUndefined();
  });

  it('retries on the next call after a failed warm-up, and never rejects', async () => {
    getAvailableVoicesAsync.mockRejectedValueOnce(new Error('no engine'));

    await expect(warmUpDeviceVoice()).resolves.toBeUndefined();
    await warmUpDeviceVoice();

    expect(getAvailableVoicesAsync).toHaveBeenCalledTimes(2);
  });
});

describe('speakAsync ready deadline', () => {
  it('asks Google for audio within GOOGLE_TTS_READY_DEADLINE_MS', async () => {
    speakWithGoogleTtsAsync.mockResolvedValue(undefined);
    await speakAsync('hello', { rate: 1.1 });
    expect(speakWithGoogleTtsAsync).toHaveBeenCalledWith('hello', { rate: 1.1, readyDeadlineMs: 2000 });
  });

  it('speaks on the device voice when Google misses the deadline, without starting the failure cooldown', async () => {
    speakWithGoogleTtsAsync.mockRejectedValueOnce(new MockGoogleTtsNotReadyError('slow'));
    speak.mockImplementation((_text, options) => options?.onDone?.());

    await speakAsync('Hazard reported, 2 kilometres ahead.');

    expect(speak).toHaveBeenCalledWith('Hazard reported, 2 kilometres ahead.', expect.anything());
    expect(getLastGoogleTtsError()).toBeNull();

    // Next alert goes straight back to Google - no cooldown.
    speakWithGoogleTtsAsync.mockResolvedValueOnce(undefined);
    speak.mockClear();
    await speakAsync('next');
    expect(speakWithGoogleTtsAsync).toHaveBeenCalledTimes(2);
    expect(speak).not.toHaveBeenCalled();
  });

  it('still rejects if the device voice also fails after a missed deadline', async () => {
    speakWithGoogleTtsAsync.mockRejectedValueOnce(new MockGoogleTtsNotReadyError('slow'));
    speak.mockImplementation((_text, options) => options?.onError?.(new Error('no engine')));

    await expect(speakAsync('hello')).rejects.toThrow('no engine');
  });
});
