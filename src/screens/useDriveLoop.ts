import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import {
  startBackgroundLocationUpdatesAsync,
  stopBackgroundLocationUpdatesAsync,
} from '../background/locationTask';
import type { DriverState } from '../engine/types';
import { BACKGROUND_DENIED_EXPLANATION, ensureLocationPermissions } from '../location/permissions';
import { toDriverState } from '../location/toDriverState';
import { configureDuckingAudioSession } from '../speech/audioSession';
import { handleDriverUpdate, resetTripRuntime } from '../trip/tripRuntime';
import { useTripStore } from '../store/useTripStore';

const FOREGROUND_LOCATION_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
  timeInterval: 3000,
  /** Matches (and comfortably exceeds) engine/constants.ts's SIGNIFICANT_MOVEMENT_THRESHOLD_M
   * assumption that the location provider is already distance-filtered. */
  distanceInterval: 10,
};

/**
 * Drives the Drive screen with real device location: requests foreground
 * permission (blocking - the app can't do anything without it), then
 * separately requests background permission (non-blocking - denied just
 * means alerts stop when the app isn't in the foreground, noted via the
 * banner, not a hard failure). Every position update goes through
 * trip/tripRuntime.ts, the same shared pipeline the background location
 * task uses, so foreground and background execution can't drift apart
 * or double-announce.
 */
export function useDriveLoop(): void {
  const setLocationError = useTripStore((state) => state.setLocationError);
  const setBannerMessage = useTripStore((state) => state.setBannerMessage);

  const driverRef = useRef<DriverState | null>(null);

  useEffect(() => {
    resetTripRuntime();
    configureDuckingAudioSession().catch((error) => {
      console.warn('[speech] failed to configure audio session', error);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      const permissions = await ensureLocationPermissions();
      if (cancelled) return;

      if (!permissions.foregroundGranted) {
        setLocationError(permissions.explanation);
        return;
      }
      setLocationError(null);

      if (permissions.backgroundGranted) {
        startBackgroundLocationUpdatesAsync().catch((error) => {
          console.warn('[location] failed to start background updates', error);
        });
      } else {
        setBannerMessage(BACKGROUND_DENIED_EXPLANATION);
      }

      subscription = await Location.watchPositionAsync(FOREGROUND_LOCATION_OPTIONS, (location) => {
        const driver = toDriverState(
          {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            heading: location.coords.heading,
            speed: location.coords.speed,
          },
          driverRef.current
        );
        driverRef.current = driver;
        void handleDriverUpdate(driver, Date.now());
      });
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
      stopBackgroundLocationUpdatesAsync().catch(() => {});
    };
  }, [setLocationError, setBannerMessage]);
}
