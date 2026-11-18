type DeviceSpeakOptions = {
  rate?: number;
  volume?: number;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (error: Error) => void;
};

const speak = jest.fn<void, [string, DeviceSpeakOptions | undefined]>();
const stop = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-speech', () => ({
  speak: (text: string, options?: DeviceSpeakOptions) => speak(text, options),
  stop: () => stop(),
}));

const speakWithGoogleTtsAsync = jest.fn<Promise<void>, [string, Record<string, unknown>?]>();
const stopGoogleTtsSpeech = jest.fn();

jest.mock('../googleTts', () => ({
  speakWithGoogleTtsAsync: (...args: [string, Record<string, unknown>?]) =>
    speakWithGoogleTtsAsync(...args),
  stopGoogleTtsSpeech: () => stopGoogleTtsSpeech(),
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
  stopGoogleTtsSpeech.mockClear();
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
      { rate: 1.1, volume: 0.8 }
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
