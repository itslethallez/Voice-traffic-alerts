import type { WazeAlert, WazeAlertType } from '../api/waze/types';
import type { AnnounceableAlert } from '../engine/types';
import { compassDirection, type CompassDirection } from '../geo/bearing';
import { getCachedSuburb } from '../geo/suburbLookup';
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
 *
 * Waze alerts sitting at an intersection sometimes give a slash-joined
 * street pair ("Main Rd/Cross Rd") - treating that as a single string
 * would only ever touch the very first and last word of the *whole*
 * thing, expanding the trailing "Rd" while leaving "Rd/Cross" in the
 * middle untouched. Expand each side of the slash independently instead.
 */
function expandRoadName(street: string): string {
  if (street.includes('/')) {
    return street
      .split('/')
      .map((segment) => expandRoadName(segment.trim()))
      .join('/');
  }

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

function normalizeNearBy(nearBy: string | null | undefined): string | null {
  const trimmed = nearBy?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Prefers the real suburb (from geo/suburbLookup's reverse-geocode cache,
 * prefetched by tripRuntime.ts as soon as alerts land) over Waze's own
 * `city` field, which is frequently too coarse to be useful in practice -
 * live testing showed every alert across a huge span of metro Adelaide
 * came back with the same `city: "Adelaide"`. Falls back to `city` when
 * the suburb hasn't resolved yet (still in flight) or none was found.
 * A pure, synchronous read - never triggers a network call itself.
 */
function resolveAreaName(alert: WazeAlert): string | null {
  const suburb = getCachedSuburb({ latitude: alert.latitude, longitude: alert.longitude });
  return suburb ?? normalizeCity(alert.city);
}

/**
 * "on {street}, {area}" / "on {street}, near {near_by}" / "on {street}"
 * / "in {area}" / "near {near_by}" / null, in that preference order. A
 * route number is never spoken (see spokenStreet) - the area name (see
 * resolveAreaName) or, failing that, `near_by`, carries the location
 * instead. `near_by` is a real field on WazeAlert that was previously
 * unused - `city` is frequently blank or too coarse in practice, and the
 * area rarely getting named at all is exactly the complaint this fallback
 * tier addresses.
 */
function locationPhrase(
  street: string | null | undefined,
  area: string | null | undefined,
  nearBy: string | null | undefined
): string | null {
  const spoken = spokenStreet(street);
  const normalizedArea = area?.trim() || null;
  const normalizedNearBy = normalizeNearBy(nearBy);

  if (spoken && normalizedArea) return `on ${spoken}, ${normalizedArea}`;
  if (spoken && normalizedNearBy) return `on ${spoken}, near ${normalizedNearBy}`;
  if (spoken) return `on ${spoken}`;
  if (normalizedArea) return `in ${normalizedArea}`;
  if (normalizedNearBy) return `near ${normalizedNearBy}`;
  return null;
}

/**
 * "{type} reported on {street}, {suburb}, {direction}bound, {distance}
 * ahead." (falling back through locationPhrase's other tiers - near_by
 * instead of suburb, just the street, just an area name, or the bare
 * distance-only wording when none of those are usable) plus, if the
 * report is over 10 minutes old, an appended "Reported {n} minutes ago."
 * - stale data pretending to be live is the main way this app loses
 * trust. The road/route number itself is never spoken - see spokenStreet.
 */
export function formatAnnouncement(candidate: AnnounceableAlert): string {
  const label = labelForType(candidate.alert.type);
  const distance = formatDistance(candidate.distanceMeters);
  const location = locationPhrase(candidate.alert.street, resolveAreaName(candidate.alert), candidate.alert.near_by);

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
  /** The suburb when resolved (see resolveAreaName), falling back to
   * Waze's own `city` field otherwise. */
  area: string | null;
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
    area: resolveAreaName(candidate.alert),
    direction: compassDirection(candidate.driverHeadingDeg),
  };
}

export const NO_BRIEFING_ALERTS_MESSAGE = 'No recent alerts within your briefing area.';

/**
 * Cold-start briefing wording - always states the age (unlike
 * formatAnnouncement, which only appends it past the staleness cutoff),
 * since a briefing is explicitly about "how current is this" situational
 * awareness. Prefers "on {street}, {suburb}" (never the route number -
 * see spokenStreet), falls back through locationPhrase's other tiers, and
 * only falls all the way back to distance if none of those are usable - a
 * stationary cold-start briefing has no meaningful direction of travel, so unlike
 * formatAnnouncement this never appends "-bound".
 */
export function formatBriefingAlert(candidate: AnnounceableAlert): string {
  const label = labelForType(candidate.alert.type);
  const age = formatAge(candidate.ageMinutes);
  const location = locationPhrase(candidate.alert.street, resolveAreaName(candidate.alert), candidate.alert.near_by);

  if (location) {
    return `${label} reported ${location}, ${age} ago.`;
  }

  const distance = formatDistance(candidate.distanceMeters);
  return `${label} reported ${distance} away, ${age} ago.`;
}
