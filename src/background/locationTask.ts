import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { DriverState } from '../engine/types';
import { toDriverState } from '../location/toDriverState';
import { handleDriverUpdate } from '../trip/tripRuntime';

export const BACKGROUND_LOCATION_TASK_NAME = 'voice-traffic-alerts/background-location';

/**
 * Best-effort continuity for the GPS-heading fallback (see
 * toDriverState.ts) across invocations of this task. The background JS
 * context can be torn down and respawned by the OS between deliveries,
 * in which case this resets to null and the first sample of a new
 * invocation falls back to heading 0 rather than crashing - documented
 * in toDriverState.ts, not a bug specific to this file.
 */
let lastKnownDriver: DriverState | null = null;

/**
 * Must run in the JS bundle's module scope, not inside a component or
 * effect - TaskManager spins up the JS app, runs this, and tears it back
 * down when the OS wakes it in the background, with no views mounted.
 * That's why this file is imported for its side effect from index.ts,
 * as early as possible, rather than from a screen.
 */
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  BACKGROUND_LOCATION_TASK_NAME,
  async ({ data, error }) => {
    if (error) {
      console.warn('[background-location] task error', error);
      return;
    }
    if (!data?.locations?.length) return;

    const now = Date.now();
    for (const location of data.locations) {
      const driver = toDriverState(
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          heading: location.coords.heading,
          speed: location.coords.speed,
        },
        lastKnownDriver
      );
      lastKnownDriver = driver;
      await handleDriverUpdate(driver, now);
    }
  }
);

export async function startBackgroundLocationUpdatesAsync(): Promise<void> {
  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(
    BACKGROUND_LOCATION_TASK_NAME
  );
  if (alreadyStarted) return;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    activityType: Location.ActivityType.AutomotiveNavigation,
    timeInterval: 15_000,
    distanceInterval: 25,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Voice Traffic Alerts',
      notificationBody: 'Listening for alerts on your route.',
    },
  });
}

export async function stopBackgroundLocationUpdatesAsync(): Promise<void> {
  const isStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME);
  if (!isStarted) return;
  await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME);
}
