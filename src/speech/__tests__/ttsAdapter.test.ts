type SpeakOptions = {
  rate?: number;
  volume?: number;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (error: Error) => void;
};

const speak = jest.fn<void, [string, SpeakOptions | undefined]>();
const stop = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-speech', () => ({
  speak: (text: string, options?: SpeakOptions) => speak(text, options),
  stop: () => stop(),
}));

import { speakAsync, stopSpeaking } from '../ttsAdapter';

describe('speakAsync', () => {
  beforeEach(() => {
    speak.mockClear();
    stop.mockClear();
  });

  it('passes the text and rate/volume through to expo-speech', async () => {
    speak.mockImplementation((_text, options) => options?.onDone?.());
    await speakAsync('Police reported, 800 metres ahead.', { rate: 1.1, volume: 0.8 });

    expect(speak).toHaveBeenCalledWith(
      'Police reported, 800 metres ahead.',
      expect.objectContaining({ rate: 1.1, volume: 0.8 })
    );
  });

  it('resolves when onDone fires', async () => {
    speak.mockImplementation((_text, options) => options?.onDone?.());
    await expect(speakAsync('hello')).resolves.toBeUndefined();
  });

  it('resolves when onStopped fires', async () => {
    speak.mockImplementation((_text, options) => options?.onStopped?.());
    await expect(speakAsync('hello')).resolves.toBeUndefined();
  });

  it('rejects when onError fires', async () => {
    const error = new Error('tts failed');
    speak.mockImplementation((_text, options) => options?.onError?.(error));
    await expect(speakAsync('hello')).rejects.toThrow('tts failed');
  });
});

describe('stopSpeaking', () => {
  it('delegates to expo-speech stop()', async () => {
    await stopSpeaking();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
