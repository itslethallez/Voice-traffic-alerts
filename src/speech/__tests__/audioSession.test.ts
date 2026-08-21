const setAudioModeAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-audio', () => ({
  setAudioModeAsync: (...args: unknown[]) => setAudioModeAsync(...args),
}));

import { configureDuckingAudioSession, configureRecordingAudioSession } from '../audioSession';

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

describe('configureRecordingAudioSession', () => {
  beforeEach(() => {
    setAudioModeAsync.mockClear();
  });

  it('enables allowsRecording alongside the usual ducking playback settings', async () => {
    await configureRecordingAudioSession();
    expect(setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
    });
  });
});
