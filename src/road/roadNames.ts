/**
 * Road-name matching between sources that spell the same road differently:
 * Waze ("A1 - Main North Road", "R1 - Fitzroy Tce (City Ring Route)"),
 * Mapbox Directions step names ("Main North Road"), SAPOL camera labels
 * ("Kensington Road/Portrush Road, MARRYATVILLE") and police mobile-camera
 * notices ("PORTRUSH RD, MAYLANDS").
 *
 * Deliberately conservative: two names match only when they normalise to
 * the same string. A false "same road" turns into a false "ahead on X",
 * which is exactly what road matching exists to prevent; a false "different
 * road" only downgrades the wording to "nearby".
 */

const SUFFIXES: Readonly<Record<string, string>> = {
  rd: 'road',
  st: 'street',
  tce: 'terrace',
  terr: 'terrace',
  ave: 'avenue',
  av: 'avenue',
  hwy: 'highway',
  pde: 'parade',
  dr: 'drive',
  cres: 'crescent',
  cr: 'crescent',
  pl: 'place',
  ct: 'court',
  blvd: 'boulevard',
  bvd: 'boulevard',
  fwy: 'freeway',
  esp: 'esplanade',
  gr: 'grove',
  cct: 'circuit',
  ln: 'lane',
  sq: 'square',
  mwy: 'motorway',
  expy: 'expressway',
};

/** "A1 - ", "R1 - ", "M2 - " route-number prefixes (Waze); "(A1)",
 * "(City Ring Route)" parentheticals (Waze and Mapbox). */
const ROUTE_PREFIX = /^[a-z]\d{1,3}\s*-\s*/;
const PARENTHETICAL = /\([^)]*\)/g;

export function normalizeRoadName(name: string | null | undefined): string | null {
  if (!name) return null;
  let s = name.toLowerCase().replace(PARENTHETICAL, ' ').trim();
  s = s.replace(ROUTE_PREFIX, '');
  // "to South Rd to A7 - Port Road/..." - a Waze ramp description, not a road.
  if (/^to\s/.test(s)) return null;
  const words = s
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SUFFIXES[w] ?? w);
  if (words.length === 0) return null;
  // A bare route number ("a1", "m2") isn't a road name we can match on.
  if (words.length === 1 && /^[a-z]\d{1,3}$/.test(words[0])) return null;
  return words.join(' ');
}

/** Every road a free-text location names: "X Road/Y Road, SUBURB" -> both. */
export function roadNamesIn(label: string | null | undefined): string[] {
  if (!label) return [];
  const streetPart = label.split(',')[0];
  return streetPart
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function sameRoad(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeRoadName(a);
  const nb = normalizeRoadName(b);
  return na !== null && na === nb;
}

export function anySameRoad(candidates: readonly string[], name: string | null | undefined): boolean {
  return candidates.some((c) => sameRoad(c, name));
}
