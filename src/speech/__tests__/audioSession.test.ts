const setAudioModeAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-audio', () => ({
  setAudioModeAsync: (...args: unknown[]) => setAudioModeAsync(...args),
}));

import { configureDuckingAudioSession } from '../audioSession';

describe('configureDuckingAudioSession', () => {
  beforeEach(() => {
    setAudioModeAsync.mockClear();
  });

  it('requests duckOthers interruption mode with silent-mode playback allowed', async () => {
    await configureDuckingAudioSession();
    expect(setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
    });
  });
});
