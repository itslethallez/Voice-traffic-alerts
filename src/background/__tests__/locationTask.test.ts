const defineTask = jest.fn();
const hasStartedLocationUpdatesAsync = jest.fn();
const startLocationUpdatesAsync = jest.fn().mockResolvedValue(undefined);
const stopLocationUpdatesAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-task-manager', () => ({
  defineTask: (...args: unknown[]) => defineTask(...args),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4 },
  ActivityType: { AutomotiveNavigation: 2 },
  hasStartedLocationUpdatesAsync: (...args: unknown[]) => hasStartedLocationUpdatesAsync(...args),
  startLocationUpdatesAsync: (...args: unknown[]) => startLocationUpdatesAsync(...args),
  stopLocationUpdatesAsync: (...args: unknown[]) => stopLocationUpdatesAsync(...args),
}));

jest.mock('../../trip/tripRuntime', () => ({
  handleDriverUpdate: jest.fn().mockResolvedValue(undefined),
}));

import {
  BACKGROUND_LOCATION_TASK_NAME,
  startBackgroundLocationUpdatesAsync,
  stopBackgroundLocationUpdatesAsync,
} from '../locationTask';

describe('locationTask', () => {
  beforeEach(() => {
    hasStartedLocationUpdatesAsync.mockReset();
    startLocationUpdatesAsync.mockClear();
    stopLocationUpdatesAsync.mockClear();
  });

  it('registers the background task at module load with a stable name', () => {
    expect(defineTask).toHaveBeenCalledTimes(1);
    expect(defineTask).toHaveBeenCalledWith(BACKGROUND_LOCATION_TASK_NAME, expect.any(Function));
  });

  it('requests HIGH accuracy at the same cadence as the foreground watch', async () => {
    // This task is the ONLY location request left alive once the screen
    // goes off (expo-location drops every watchPositionAsync subscription
    // when the activity backgrounds), so anything below HIGH leaves GMS
    // free to keep the GPS chip off and the app hears nothing at all.
    hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    await startBackgroundLocationUpdatesAsync();
    expect(startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(startLocationUpdatesAsync).toHaveBeenCalledWith(
      BACKGROUND_LOCATION_TASK_NAME,
      expect.objectContaining({ accuracy: 4, timeInterval: 3_000, distanceInterval: 10 })
    );
  });

  it('re-applies its options even when the task is already started', async () => {
    // The registration (options included) is persisted across restarts
    // and app updates, so skipping the call on "already started" would
    // pin an existing install to whatever options it first registered.
    hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await startBackgroundLocationUpdatesAsync();
    expect(startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  it('stops updates only if currently started', async () => {
    hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await stopBackgroundLocationUpdatesAsync();
    expect(stopLocationUpdatesAsync).toHaveBeenCalledWith(BACKGROUND_LOCATION_TASK_NAME);
  });

  it('does not attempt to stop updates that were never started', async () => {
    hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    await stopBackgroundLocationUpdatesAsync();
    expect(stopLocationUpdatesAsync).not.toHaveBeenCalled();
  });
});
