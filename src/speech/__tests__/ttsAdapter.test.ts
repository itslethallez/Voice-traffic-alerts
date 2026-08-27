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

import { getLastGoogleTtsError, speakAsync, stopSpeaking } from '../ttsAdapter';

describe('speakAsync', () => {
  beforeEach(() => {
    speak.mockClear();
    stop.mockClear();
    speakWithGoogleTtsAsync.mockReset();
    stopGoogleTtsSpeech.mockClear();
  });

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
});

describe('getLastGoogleTtsError', () => {
  it('records the failure message when Google TTS falls back to the device voice', async () => {
    speakWithGoogleTtsAsync.mockRejectedValue(new Error('Google TTS request failed with status 401'));
    speak.mockImplementation((_text, options) => options?.onDone?.());

    await speakAsync('hello');

    expect(getLastGoogleTtsError()).toBe('Google TTS request failed with status 401');
  });

  it('clears back to null once a later call succeeds', async () => {
    speakWithGoogleTtsAsync.mockRejectedValueOnce(new Error('Google TTS request failed with status 401'));
    speak.mockImplementation((_text, options) => options?.onDone?.());
    await speakAsync('hello');
    expect(getLastGoogleTtsError()).not.toBeNull();

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
