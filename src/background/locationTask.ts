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
 * Until the drive loop has finished its briefing and gone 'live', fixes
 * from this task go to it (useDriveLoop.ts) instead of the trip runtime:
 * on a screen-off cold start this task is the ONLY location source - the
 * foreground watch never delivers without a resumed activity - so it has
 * to be what starts the briefing. Once live, fixes go straight to
 * handleDriverUpdate as before.
 */
type PreLiveFixListener = (location: Location.LocationObject) => void;
let preLiveFixListener: PreLiveFixListener | null = null;

export function setPreLiveFixListener(listener: PreLiveFixListener | null): void {
  preLiveFixListener = listener;
}

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

    // Only the newest location in each batch is worth a full engine pass -
    // position is a latest-wins value, and replaying every deferred fix
    // through the serialized chain (each potentially awaiting a TTS
    // utterance) is exactly how the queue fell behind on device.
    // handleDriverUpdate itself also drops a fix superseded while queued,
    // but there's no reason to enqueue the stale ones at all.
    if (data.locations.length > 1) {
      console.log(`[drive] background batch of ${data.locations.length} fixes - using latest only`);
    }
    const location = data.locations[data.locations.length - 1];
    if (preLiveFixListener) {
      console.log(
        `[background-location] pre-live fix lat=${location.coords.latitude.toFixed(5)} lon=${location.coords.longitude.toFixed(5)} age=${Math.round((Date.now() - location.timestamp) / 1000)}s -> drive loop`
      );
      preLiveFixListener(location);
      return;
    }
    // One line per delivery. With the screen off this task is the only
    // thing still feeding the engine, so its absence from a drive-test
    // logcat is the difference between "nothing worth announcing" and
    // "the app went deaf" - exactly the ambiguity that let the silent
    // Balanced/15s request above go unnoticed.
    console.log(
      `[background-location] fix lat=${location.coords.latitude.toFixed(5)} lon=${location.coords.longitude.toFixed(5)} speed=${location.coords.speed === null ? 'null' : `${(location.coords.speed * 3.6).toFixed(0)}km/h`}`
    );
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
    await handleDriverUpdate(driver, Date.now(), 'background');
  }
);

/**
 * Deliberately NOT guarded by hasStartedLocationUpdatesAsync(): the task
 * registration (options included) is persisted by expo-task-manager and
 * survives app restarts and app *updates*, so an early return on
 * "already started" would leave an existing install running whatever
 * options it was first registered with - forever. That's how the
 * Balanced/15s request below outlived the code that set it. Re-calling
 * start on a live task is the supported way to change options:
 * TaskService.registerTask() sees the task already exists and routes to
 * LocationTaskConsumer.setOptions(), which restarts the location request
 * with the new ones.
 */
export async function startBackgroundLocationUpdatesAsync(): Promise<void> {
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME, {
    // Must stay HIGH accuracy, and must match the foreground watch's
    // cadence (useDriveLoop.ts's FOREGROUND_LOCATION_OPTIONS) - this is
    // the ONLY location request alive once the screen goes off, not a
    // low-power supplement to the foreground one.
    //
    // expo-location tears down every watchPositionAsync subscription the
    // moment the activity is backgrounded (LocationModule's
    // OnActivityEntersBackground -> stopWatching() -> removeLocationUpdates),
    // which is a screen-off, a lock, or Waze coming to the front. The
    // old Balanced/15s request here maps to GMS
    // PRIORITY_BALANCED_POWER_ACCURACY, which deliberately does NOT turn
    // the GPS chip on - it is happy to be served by network/wifi
    // positioning. So the instant the foreground watch went away, the
    // GPS provider dropped to ProviderRequest[OFF] and the app stopped
    // receiving fixes at all: no driver updates, no announcements, a
    // silent co-pilot with the screen off.
    //
    // 15s was also far too coarse to drive on: at 100 km/h that is 420m
    // between fixes, which steps straight over the 500m/200m speed-camera
    // warning checkpoints (engine/selectSpeedCameraWarning.ts). Cruising
    // already holds a location foreground service for the whole trip, so
    // there is no battery to save by under-requesting here.
    accuracy: Location.Accuracy.High,
    activityType: Location.ActivityType.AutomotiveNavigation,
    timeInterval: 3_000,
    distanceInterval: 10,
    showsBackgroundLocationIndicator: true,
    // iOS: expo-location defaults this to TRUE, and with
    // AutomotiveNavigation iOS then pauses GPS once the car sits still
    // for a while (long lights, a jam). A paused app in the background
    // never gets updates back until it is reopened - the iOS twin of the
    // Android Balanced-accuracy bug above: a deaf co-pilot with the
    // screen locked. Ignored on Android.
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Voice Traffic Alerts',
      notificationBody: 'Listening for alerts on your route.',
      // Without this, swiping the app away in Android's recent-apps
      // switcher leaves the foreground service (and this task, and every
      // announcement it triggers) running indefinitely in the background -
      // the OS only tears it down on `killServiceOnDestroy: true`, via
      // LocationTaskService.onTaskRemoved(). Defaults to false upstream.
      killServiceOnDestroy: true,
    },
  });
}

export async function stopBackgroundLocationUpdatesAsync(): Promise<void> {
  const isStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME);
  if (!isStarted) return;
  await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME);
}
