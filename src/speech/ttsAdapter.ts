import * as Speech from 'expo-speech';

export interface SpeakOptions {
  rate?: number;
  volume?: number;
}

/**
 * Promise wrapper around expo-speech's callback-based speak(), so the
 * announcer can simply await one utterance before dispatching the next.
 */
export function speakAsync(text: string, options: SpeakOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    Speech.speak(text, {
      rate: options.rate,
      volume: options.volume,
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: (error) => reject(error),
    });
  });
}

export function stopSpeaking(): Promise<void> {
  return Speech.stop();
}
