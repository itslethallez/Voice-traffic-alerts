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

const speakWithElevenLabsAsync = jest.fn<Promise<void>, [string, Record<string, unknown>?]>();
const stopElevenLabsSpeech = jest.fn();

jest.mock('../elevenLabsTts', () => ({
  speakWithElevenLabsAsync: (...args: [string, Record<string, unknown>?]) =>
    speakWithElevenLabsAsync(...args),
  stopElevenLabsSpeech: () => stopElevenLabsSpeech(),
}));

import { getLastElevenLabsError, speakAsync, stopSpeaking } from '../ttsAdapter';

describe('speakAsync', () => {
  beforeEach(() => {
    speak.mockClear();
    stop.mockClear();
    speakWithElevenLabsAsync.mockReset();
    stopElevenLabsSpeech.mockClear();
  });

  it('speaks via ElevenLabs and never touches the device voice when it succeeds', async () => {
    speakWithElevenLabsAsync.mockResolvedValue(undefined);

    await speakAsync('Police reported, 800 metres ahead.', { rate: 1.1, volume: 0.8 });

    expect(speakWithElevenLabsAsync).toHaveBeenCalledWith(
      'Police reported, 800 metres ahead.',
      { rate: 1.1, volume: 0.8 }
    );
    expect(speak).not.toHaveBeenCalled();
  });

  it('falls back to the on-device voice when ElevenLabs fails', async () => {
    speakWithElevenLabsAsync.mockRejectedValue(new Error('ElevenLabs down'));
    speak.mockImplementation((_text, options) => options?.onDone?.());

    await speakAsync('hello', { rate: 1.1, volume: 0.8 });

    expect(speak).toHaveBeenCalledWith('hello', expect.objectContaining({ rate: 1.1, volume: 0.8 }));
  });

  it('resolves once the device fallback finishes (onDone)', async () => {
    speakWithElevenLabsAsync.mockRejectedValue(new Error('ElevenLabs down'));
    speak.mockImplementation((_text, options) => options?.onDone?.());

    await expect(speakAsync('hello')).resolves.toBeUndefined();
  });

  it('resolves once the device fallback finishes (onStopped)', async () => {
    speakWithElevenLabsAsync.mockRejectedValue(new Error('ElevenLabs down'));
    speak.mockImplementation((_text, options) => options?.onStopped?.());

    await expect(speakAsync('hello')).resolves.toBeUndefined();
  });

  it('rejects only once both ElevenLabs and the device fallback have failed', async () => {
    speakWithElevenLabsAsync.mockRejectedValue(new Error('ElevenLabs down'));
    const deviceError = new Error('device tts failed too');
    speak.mockImplementation((_text, options) => options?.onError?.(deviceError));

    await expect(speakAsync('hello')).rejects.toThrow('device tts failed too');
  });
});

describe('getLastElevenLabsError', () => {
  it('records the failure message when ElevenLabs falls back to the device voice', async () => {
    speakWithElevenLabsAsync.mockRejectedValue(new Error('ElevenLabs TTS request failed with status 401'));
    speak.mockImplementation((_text, options) => options?.onDone?.());

    await speakAsync('hello');

    expect(getLastElevenLabsError()).toBe('ElevenLabs TTS request failed with status 401');
  });

  it('clears back to null once a later call succeeds', async () => {
    speakWithElevenLabsAsync.mockRejectedValueOnce(new Error('ElevenLabs TTS request failed with status 401'));
    speak.mockImplementation((_text, options) => options?.onDone?.());
    await speakAsync('hello');
    expect(getLastElevenLabsError()).not.toBeNull();

    speakWithElevenLabsAsync.mockResolvedValueOnce(undefined);
    await speakAsync('hello again');

    expect(getLastElevenLabsError()).toBeNull();
  });
});

describe('stopSpeaking', () => {
  it('stops both the ElevenLabs and on-device backends unconditionally', async () => {
    await stopSpeaking();

    expect(stopElevenLabsSpeech).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
