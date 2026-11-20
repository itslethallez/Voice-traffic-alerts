import type { AnnounceableAlert, ApproachingAlert, DriverState } from '../engine/types';
import { MIN_ANNOUNCEMENT_GAP_MS } from './constants';
import { formatAnnouncement } from './formatAnnouncement';
import type { AnnouncementQueueState } from './types';

/**
 * Both location sources (screens/useDriveLoop.ts's foreground watch and
 * background/locationTask.ts) deliver a fix every 3s, and tick() only runs
 * on a fix - so an alert due at T is actually dispatched somewhere in
 * [T, T + 3s].
 */
export const DRIVER_UPDATE_INTERVAL_MS = 3_000;

/**
 * How far ahead this schedules. 45s covers the queue head plus the next
 * slot behind it (20s gap each) and, at 80 km/h, an alert ~1km outside the
 * warn radius. Further out, a speed change moves the guess by more than
 * the 100m the spoken distance is rounded to, and each miss is a wasted
 * Google TTS request.
 */
export const PREFETCH_HORIZON_MS = 45_000;

/** Upper bound on sentences returned per call - a dense stretch of road
 * with a long queue shouldn't fire a burst of TTS requests. */
export const MAX_PREFETCH_TEXTS = 8;

/**
 * The sentences tick() is most likely to speak in the next
 * PREFETCH_HORIZON_MS, for ttsAudioCache.ts to fetch ahead of time.
 *
 * formatAnnouncement() rounds distance to 100m, so an alert's sentence
 * keeps changing as the driver closes on it (every ~4.5s at 80 km/h). What
 * needs fetching is the sentence as it will read at the moment it's
 * spoken. So this lays out the queue's own schedule - one announcement per
 * MIN_ANNOUNCEMENT_GAP_MS, pending items in their severity order, then
 * approaching alerts in the order they'll cross into the warn radius - and
 * formats each item at its projected slot: distance closed at the driver's
 * current speed, age advanced. Each slot is formatted at both ends of the
 * 3s window dispatch can land in (DRIVER_UPDATE_INTERVAL_MS) - usually one
 * or two distinct sentences.
 *
 * An approaching alert is fetched from the moment it's found, not when it
 * enters the radius: its entry sentence ("... 5 kilometres ahead.") only
 * depends on where the radius edge is, so it's stable on every update
 * from then on and costs one fetch, not one per update.
 *
 * `measuredAtMs` is when the candidates' distances were measured (the
 * driver-update pass's nowMs); `currentMs` is now - they differ because
 * tick() may have spent seconds speaking in between.
 *
 * What this can't foresee: an alert that first appears in a feed refresh,
 * or one that swings into the 45-degree heading cone after a turn. A miss
 * costs one Google request and nothing else - tick() fetches at dispatch
 * as it always did, and speakAsync's ready deadline covers the wait.
 */
export function predictUpcomingAnnouncementTexts(
  queue: AnnouncementQueueState,
  approaching: readonly ApproachingAlert[],
  driver: DriverState,
  measuredAtMs: number,
  currentMs: number
): string[] {
  if (queue.isSpeaking) return [];

  const metersPerMs = Math.max(0, driver.speedKmh) / 3_600;
  const horizonMs = currentMs + PREFETCH_HORIZON_MS;
  const texts = new Set<string>();

  const add = (candidate: AnnounceableAlert, slotMs: number): void => {
    for (const offsetMs of [0, DRIVER_UPDATE_INTERVAL_MS]) {
      if (texts.size >= MAX_PREFETCH_TEXTS) return;
      const elapsedMs = slotMs + offsetMs - measuredAtMs;
      texts.add(
        formatAnnouncement({
          ...candidate,
          distanceMeters: Math.max(0, candidate.distanceMeters - metersPerMs * elapsedMs),
          ageMinutes: candidate.ageMinutes + elapsedMs / 60_000,
        })
      );
    }
  };

  let nextSlotMs =
    queue.lastAnnouncedAtMs === null
      ? currentMs
      : Math.max(currentMs, queue.lastAnnouncedAtMs + MIN_ANNOUNCEMENT_GAP_MS);

  for (const candidate of queue.pending) {
    if (nextSlotMs > horizonMs) return [...texts];
    add(candidate, nextSlotMs);
    nextSlotMs += MIN_ANNOUNCEMENT_GAP_MS;
  }

  // Stationary: nothing is closing on the radius, so there's no entry
  // time to predict.
  if (metersPerMs === 0) return [...texts];

  const byEntry = approaching
    .map((a) => ({
      candidate: a.candidate,
      entryAtMs: measuredAtMs + (a.candidate.distanceMeters - a.entryDistanceMeters) / metersPerMs,
    }))
    .sort((a, b) => a.entryAtMs - b.entryAtMs);

  for (const { candidate, entryAtMs } of byEntry) {
    const slotMs = Math.max(entryAtMs, nextSlotMs);
    if (slotMs > horizonMs) break;
    add(candidate, slotMs);
    nextSlotMs = slotMs + MIN_ANNOUNCEMENT_GAP_MS;
  }

  return [...texts];
}
