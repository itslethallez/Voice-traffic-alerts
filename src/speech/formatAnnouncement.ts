import type { WazeAlertType } from '../api/waze/types';
import type { AnnounceableAlert } from '../engine/types';
import { STALE_ANNOUNCEMENT_AGE_MINUTES } from './constants';

/**
 * Spoken labels, not the raw API type names - "Crash" reads better out
 * loud than "Accident" (per the spec's own example: "Crash reported,
 * 1.4 kilometres ahead.").
 */
const ANNOUNCEMENT_LABELS: Partial<Record<string, string>> = {
  POLICE: 'Police',
  ACCIDENT: 'Crash',
  HAZARD: 'Hazard',
  ROAD_CLOSED: 'Road closed',
  JAM: 'Traffic jam',
};

function labelForType(type: WazeAlertType): string {
  return ANNOUNCEMENT_LABELS[type] ?? 'Alert';
}

/** Nearest 100m under 1km, nearest 0.1km at or above 1km. */
export function formatDistance(distanceMeters: number): string {
  if (distanceMeters < 1000) {
    const roundedMeters = Math.round(distanceMeters / 100) * 100;
    return `${roundedMeters} metres`;
  }
  const km = Math.round(distanceMeters / 100) / 10;
  return km === 1 ? '1 kilometre' : `${km} kilometres`;
}

function formatAge(ageMinutes: number): string {
  const roundedMinutes = Math.round(ageMinutes);
  return roundedMinutes === 1 ? '1 minute' : `${roundedMinutes} minutes`;
}

/**
 * "{type} reported, {distance} ahead." plus, if the report is over 10
 * minutes old, an appended "Reported {n} minutes ago." - stale data
 * pretending to be live is the main way this app loses trust.
 */
export function formatAnnouncement(candidate: AnnounceableAlert): string {
  const label = labelForType(candidate.alert.type);
  const distance = formatDistance(candidate.distanceMeters);
  let text = `${label} reported, ${distance} ahead.`;

  if (candidate.ageMinutes > STALE_ANNOUNCEMENT_AGE_MINUTES) {
    text += ` Reported ${formatAge(candidate.ageMinutes)} ago.`;
  }

  return text;
}
