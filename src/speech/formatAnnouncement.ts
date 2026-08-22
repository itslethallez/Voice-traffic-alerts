import type { WazeAlertType } from '../api/waze/types';
import type { AnnounceableAlert } from '../engine/types';
import { compassDirection, type CompassDirection } from '../geo/bearing';
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

/** Exported for the radar UI's Nearby Transmission card (Step 11b), which
 * needs the same spoken label without duplicating this table. */
export function labelForType(type: WazeAlertType): string {
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

/**
 * Road-type suffix abbreviations expanded to full words so TTS reads them
 * naturally ("Anzac Highway", not "Anzac Hwy" spelled out letter by
 * letter). Keyed lowercase, matched against the last word of the street
 * name only - suffixes are unambiguous there, unlike a leading "St"
 * (see expandRoadName's separate "Saint" handling).
 */
const ROAD_SUFFIX_ABBREVIATIONS: Record<string, string> = {
  hwy: 'Highway',
  fwy: 'Freeway',
  expy: 'Expressway',
  rd: 'Road',
  st: 'Street',
  ave: 'Avenue',
  av: 'Avenue',
  dr: 'Drive',
  ct: 'Court',
  pde: 'Parade',
  tce: 'Terrace',
  cres: 'Crescent',
  cct: 'Circuit',
  blvd: 'Boulevard',
  bvd: 'Boulevard',
  ln: 'Lane',
  pl: 'Place',
  sq: 'Square',
  cl: 'Close',
  gr: 'Grove',
};

/**
 * Expands a road-type abbreviation at the end of a street name ("Anzac
 * Hwy" -> "Anzac Highway", "Anzac Rd" -> "Anzac Road") and a leading "St"
 * to "Saint" ("St Kilda Road" -> "Saint Kilda Road") - the one case where
 * "St" means something other than "Street". Only the first and last
 * words are ever touched, so ordinary multi-word names are left alone.
 */
function expandRoadName(street: string): string {
  const words = street.split(/\s+/);
  if (words.length === 0) return street;

  const lastIndex = words.length - 1;
  const lastKey = words[lastIndex].replace(/\.$/, '').toLowerCase();
  const suffixExpansion = ROAD_SUFFIX_ABBREVIATIONS[lastKey];
  if (suffixExpansion) {
    words[lastIndex] = suffixExpansion;
  }

  const firstKey = words[0].replace(/\.$/, '').toLowerCase();
  if (firstKey === 'st' && words.length > 1) {
    words[0] = 'Saint';
  }

  return words.join(' ');
}

/** null, undefined, empty, whitespace-only, or a bare route number all
 * count as "no speakable street name". */
function spokenStreet(street: string | null | undefined): string | null {
  const trimmed = street?.trim();
  if (!trimmed || ROUTE_NUMBER_PATTERN.test(trimmed)) return null;
  return expandRoadName(trimmed);
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

export interface AnnouncementLocation {
  /** Never a bare route number - see spokenStreet. */
  street: string | null;
  city: string | null;
  direction: CompassDirection;
}

/**
 * The structured pieces formatAnnouncement()'s sentence is built from -
 * exported for the radar UI's Nearby Transmission card (Step 11b), which
 * wants street/suburb/direction as separate fields to lay out rather than
 * one spoken sentence, without re-implementing spokenStreet's route-number
 * detection or compassDirection's quantizing itself.
 */
export function announcementLocation(candidate: AnnounceableAlert): AnnouncementLocation {
  return {
    street: spokenStreet(candidate.alert.street),
    city: normalizeCity(candidate.alert.city),
    direction: compassDirection(candidate.driverHeadingDeg),
  };
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
