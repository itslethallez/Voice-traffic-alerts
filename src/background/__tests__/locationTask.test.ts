const defineTask = jest.fn();
const hasStartedLocationUpdatesAsync = jest.fn();
const startLocationUpdatesAsync = jest.fn().mockResolvedValue(undefined);
const stopLocationUpdatesAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-task-manager', () => ({
  defineTask: (...args: unknown[]) => defineTask(...args),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
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

  it('starts updates only if not already started', async () => {
    hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    await startBackgroundLocationUpdatesAsync();
    expect(startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(startLocationUpdatesAsync).toHaveBeenCalledWith(
      BACKGROUND_LOCATION_TASK_NAME,
      expect.objectContaining({ distanceInterval: 25 })
    );
  });

  it('does not start updates again if already started', async () => {
    hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await startBackgroundLocationUpdatesAsync();
    expect(startLocationUpdatesAsync).not.toHaveBeenCalled();
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
