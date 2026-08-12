import { useEffect, useRef } from 'react';
import { mockAlerts } from '../api/waze/__mocks__/alerts.fixture';
import { selectAnnounceableAlerts } from '../engine/selectAlerts';
import { createInitialAnnouncerState, submitCandidates, tick } from '../speech/announcer';
import { configureDuckingAudioSession } from '../speech/audioSession';
import { useTripStore } from '../store/useTripStore';
import { advanceSimulatedDriver, initialSimulatedDriver } from './tripSimulator';

/**
 * How often the simulated drive loop re-evaluates, not the real Waze
 * polling cadence (45s/5min from engine/constants.ts) - there's no
 * network fetch to space out yet since Step 6-7 run on the mock fixture.
 * 1s keeps the simulation feeling live for a demo.
 */
const SIMULATION_TICK_MS = 1000;

/**
 * Drives the Drive screen: advances a simulated driver position, runs it
 * through the Step 4 filtering engine against the mock fixture, and
 * dispatches qualifying alerts to the Step 5 announcer. Real location
 * (Step 8) and the live API (Step 9) will replace the simulated driver
 * and the mock fixture respectively without changing this loop's shape.
 */
export function useDriveLoop(): void {
  const isMuted = useTripStore((state) => state.isMuted);
  const pushAnnouncement = useTripStore((state) => state.pushAnnouncement);

  const driverRef = useRef(initialSimulatedDriver);
  const announcerRef = useRef(createInitialAnnouncerState());
  const lastTickAtRef = useRef<number | null>(null);

  useEffect(() => {
    configureDuckingAudioSession().catch((error) => {
      console.warn('[speech] failed to configure audio session', error);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const timer = setInterval(() => {
      void (async () => {
        if (cancelled) return;

        const now = Date.now();
        const elapsedMs = lastTickAtRef.current === null ? 0 : now - lastTickAtRef.current;
        lastTickAtRef.current = now;

        driverRef.current = advanceSimulatedDriver(driverRef.current, elapsedMs);

        if (isMuted) return;

        const candidates = selectAnnounceableAlerts(
          mockAlerts,
          driverRef.current,
          announcerRef.current.announcedIds,
          now
        );
        announcerRef.current = submitCandidates(announcerRef.current, candidates);

        const result = await tick(announcerRef.current, now);
        announcerRef.current = result.state;
        if (result.spoken) {
          pushAnnouncement(result.spoken);
        }
      })();
    }, SIMULATION_TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isMuted, pushAnnouncement]);
}
