import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import {
  startBackgroundLocationUpdatesAsync,
  stopBackgroundLocationUpdatesAsync,
} from '../background/locationTask';
import type { DriverState } from '../engine/types';
import { FirstFixGate } from '../location/firstFixGate';
import { BACKGROUND_DENIED_EXPLANATION, ensureLocationPermissions } from '../location/permissions';
import { toDriverState } from '../location/toDriverState';
import { configureDuckingAudioSession } from '../speech/audioSession';
import { addCallStateListener, startCallStateMonitoring, stopCallStateMonitoring } from '../speech/callState';
import { stopSpeaking } from '../speech/ttsAdapter';
import { handleDriverUpdate, resetTripRuntime, runBriefing } from '../trip/tripRuntime';
import { useTripStore } from '../store/useTripStore';

const FOREGROUND_LOCATION_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
  timeInterval: 3000,
  /** Matches (and comfortably exceeds) engine/constants.ts's SIGNIFICANT_MOVEMENT_THRESHOLD_M
   * assumption that the location provider is already distance-filtered. */
  distanceInterval: 10,
};

/**
 * A fix at or better than this accuracy (metres, expo-location's own
 * unit) is trusted immediately for the cold-start briefing. A worse one
 * is held for up to BRIEFING_FIX_ACCURACY_WAIT_BUDGET_MS in case a
 * tighter fix follows shortly after - common right after a cold GPS
 * start - but never blocks the briefing indefinitely; once the budget
 * elapses, the next fix (however accurate) is accepted.
 */
const BRIEFING_FIX_ACCURACY_THRESHOLD_M = 50;
const BRIEFING_FIX_ACCURACY_WAIT_BUDGET_MS = 5000;

/**
 * waitingForFirstFix -> briefing -> live, exactly once per mount. The
 * first usable fix claims the transition to 'briefing' synchronously
 * inside the watchPositionAsync callback below, before runBriefing()'s
 * first await, so a second fix arriving immediately after can't start a
 * second briefing. Fixes that arrive while phase is 'briefing' are
 * coalesced into latestPendingLocationRef (replacing whatever was there)
 * rather than replayed one-by-one or dropped outright once briefing ends.
 */
type DriveLoopPhase = 'waitingForFirstFix' | 'briefing' | 'live';

function toRawLocationSample(location: Location.LocationObject) {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    heading: location.coords.heading,
    speed: location.coords.speed,
  };
}

/**
 * Drives the Drive screen with real device location: requests foreground
 * permission (blocking - the app can't do anything without it), then
 * separately requests background permission (non-blocking - denied just
 * means alerts stop when the app isn't in the foreground, noted via the
 * banner, not a hard failure). Every position update after the initial
 * cold-start briefing goes through trip/tripRuntime.ts's
 * handleDriverUpdate, the same shared pipeline the background location
 * task uses, so foreground and background execution can't drift apart or
 * double-announce.
 */
export function useDriveLoop(): void {
  const setLocationError = useTripStore((state) => state.setLocationError);
  const setBannerMessage = useTripStore((state) => state.setBannerMessage);

  const driverRef = useRef<DriverState | null>(null);
  const phaseRef = useRef<DriveLoopPhase>('waitingForFirstFix');
  const latestPendingLocationRef = useRef<Location.LocationObject | null>(null);

  useEffect(() => {
    resetTripRuntime();
    phaseRef.current = 'waitingForFirstFix';
    latestPendingLocationRef.current = null;
    configureDuckingAudioSession().catch((error) => {
      console.warn('[speech] failed to configure audio session', error);
    });

    void startCallStateMonitoring();
    // Cuts off whatever's already mid-utterance the instant a call starts,
    // rather than waiting out the rest of that announcement first -
    // ttsAdapter.ts's speakAsync() separately refuses to *start* any new
    // one for as long as isPhoneCallActive() stays true.
    const unsubscribeCallState = addCallStateListener((event) => {
      if (event === 'active') {
        stopSpeaking().catch(() => {});
      }
    });

    return () => {
      unsubscribeCallState();
      stopCallStateMonitoring();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    let backgroundGranted = false;
    const briefingAbortController = new AbortController();
    const firstFixGate = new FirstFixGate(
      BRIEFING_FIX_ACCURACY_THRESHOLD_M,
      BRIEFING_FIX_ACCURACY_WAIT_BUDGET_MS
    );

    /** Transitions to 'live' and sends the newest pending fix (or the
     * fix the briefing itself started from, if none arrived meanwhile)
     * through the normal handleDriverUpdate path exactly once. */
    function handOffToLive(briefingDriver: DriverState) {
      if (cancelled) return;
      phaseRef.current = 'live';

      const pending = latestPendingLocationRef.current;
      latestPendingLocationRef.current = null;

      const handoffDriver = pending
        ? toDriverState(toRawLocationSample(pending), driverRef.current)
        : briefingDriver;
      driverRef.current = handoffDriver;

      void handleDriverUpdate(handoffDriver, Date.now());

      // Background delivery is deferred until we're safely in 'live' -
      // starting it any earlier would let a background fix race
      // runBriefing() for the shared announcer/cache state.
      if (backgroundGranted) {
        startBackgroundLocationUpdatesAsync().catch((error) => {
          console.warn('[location] failed to start background updates', error);
        });
      }
    }

    (async () => {
      const permissions = await ensureLocationPermissions();
      if (cancelled) return;

      if (!permissions.foregroundGranted) {
        setLocationError(permissions.explanation);
        return;
      }
      setLocationError(null);

      backgroundGranted = permissions.backgroundGranted;
      if (!backgroundGranted) {
        setBannerMessage(BACKGROUND_DENIED_EXPLANATION);
      }

      subscription = await Location.watchPositionAsync(FOREGROUND_LOCATION_OPTIONS, (location) => {
        if (cancelled) return;
        const nowMs = Date.now();

        if (phaseRef.current === 'briefing') {
          latestPendingLocationRef.current = location;
          return;
        }

        if (phaseRef.current === 'waitingForFirstFix') {
          if (!firstFixGate.isUsable(location.coords, nowMs)) return;

          phaseRef.current = 'briefing';
          const driver = toDriverState(toRawLocationSample(location), driverRef.current);
          driverRef.current = driver;

          void runBriefing(driver, nowMs, { signal: briefingAbortController.signal })
            .catch((error) => {
              console.warn('[briefing] failed', error);
            })
            .finally(() => {
              handOffToLive(driver);
            });
          return;
        }

        // phase === 'live'
        const driver = toDriverState(toRawLocationSample(location), driverRef.current);
        driverRef.current = driver;
        void handleDriverUpdate(driver, nowMs);
      });
    })();

    return () => {
      cancelled = true;
      briefingAbortController.abort();
      subscription?.remove();
      stopBackgroundLocationUpdatesAsync().catch(() => {});
    };
  }, [setLocationError, setBannerMessage]);
}
