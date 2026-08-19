import type { WazeAlertType } from '../api/waze/types';
import type { AnnounceableAlert } from '../engine/types';
import { compassDirection } from '../geo/bearing';
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
 * Matches Waze's route/highway codes ("US-101 N", "I-95", "SR-408", "A1")
 * - a bare road number doesn't mean anything spoken aloud while driving.
 * The pattern is deliberately narrow (a short letter prefix, then digits,
 * then an optional single trailing directional letter) so ordinary named
 * streets ("Northwood Ave", "5th Avenue") never match it.
 */
const ROUTE_NUMBER_PATTERN = /^[A-Za-z]{0,3}-?\d+\s*[A-Za-z]?$/;

/** null, undefined, empty, whitespace-only, or a bare route number all
 * count as "no speakable street name". */
function spokenStreet(street: string | null | undefined): string | null {
  const trimmed = street?.trim();
  if (!trimmed || ROUTE_NUMBER_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function normalizeCity(city: string | null | undefined): string | null {
  const trimmed = city?.trim();
  return trimmed ? trimmed : null;
}

/**
 * "on {street}, {suburb}" / "on {street}" / "in {suburb}" / null, in that
 * preference order. A route number is never spoken (see spokenStreet) -
 * the suburb carries the location instead.
 */
function locationPhrase(street: string | null | undefined, city: string | null | undefined): string | null {
  const spoken = spokenStreet(street);
  const normalizedCity = normalizeCity(city);

  if (spoken && normalizedCity) return `on ${spoken}, ${normalizedCity}`;
  if (spoken) return `on ${spoken}`;
  if (normalizedCity) return `in ${normalizedCity}`;
  return null;
}

/**
 * "{type} reported on {street}, {suburb}, {direction}bound, {distance}
 * ahead." (falling back to just the suburb when there's no usable street
 * name, and to the bare original wording when there's neither) plus, if
 * the report is over 10 minutes old, an appended "Reported {n} minutes
 * ago." - stale data pretending to be live is the main way this app loses
 * trust. The road/route number itself is never spoken - see spokenStreet.
 */
export function formatAnnouncement(candidate: AnnounceableAlert): string {
  const label = labelForType(candidate.alert.type);
  const distance = formatDistance(candidate.distanceMeters);
  const location = locationPhrase(candidate.alert.street, candidate.alert.city);

  let text: string;
  if (location) {
    const direction = compassDirection(candidate.driverHeadingDeg);
    text = `${label} reported ${location}, ${direction}bound, ${distance} ahead.`;
  } else {
    text = `${label} reported, ${distance} ahead.`;
  }

  if (candidate.ageMinutes > STALE_ANNOUNCEMENT_AGE_MINUTES) {
    text += ` Reported ${formatAge(candidate.ageMinutes)} ago.`;
  }

  return text;
}

export const NO_BRIEFING_ALERTS_MESSAGE = 'No recent alerts within your briefing area.';

/**
 * Cold-start briefing wording - always states the age (unlike
 * formatAnnouncement, which only appends it past the staleness cutoff),
 * since a briefing is explicitly about "how current is this" situational
 * awareness. Prefers "on {street}, {suburb}" (never the route number -
 * see spokenStreet), falls back to just the suburb, and only falls all
 * the way back to distance if the Waze data has neither - a stationary
 * cold-start briefing has no meaningful direction of travel, so unlike
 * formatAnnouncement this never appends "-bound".
 */
export function formatBriefingAlert(candidate: AnnounceableAlert): string {
  const label = labelForType(candidate.alert.type);
  const age = formatAge(candidate.ageMinutes);
  const location = locationPhrase(candidate.alert.street, candidate.alert.city);

  if (location) {
    return `${label} reported ${location}, ${age} ago.`;
  }

  const distance = formatDistance(candidate.distanceMeters);
  return `${label} reported ${distance} away, ${age} ago.`;
}
