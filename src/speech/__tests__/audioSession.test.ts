const setAudioModeAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-audio', () => ({
  setAudioModeAsync: (...args: unknown[]) => setAudioModeAsync(...args),
}));

import { configureDuckingAudioSession } from '../audioSession';

describe('configureDuckingAudioSession', () => {
  beforeEach(() => {
    setAudioModeAsync.mockClear();
  });

  it('requests duckOthers, silent-mode playback and background playback', async () => {
    await configureDuckingAudioSession();
    expect(setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    });
  });
});
