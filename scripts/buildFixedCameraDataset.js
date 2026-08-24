#!/usr/bin/env node
/**
 * Rebuilds src/data/fixedSpeedCameras.ts from SAPOL's own public "Fixed
 * camera locations" table. There is no downloadable CSV/API for this - the
 * data only exists as an HTML table on
 * https://www.police.sa.gov.au/your-safety/road-safety/traffic-camera-locations,
 * so this script scrapes it, keeps only the location types that actually
 * enforce speed (Mid Block, P2P, I/section - excludes PAC/Rail/MPDC, which
 * enforce pedestrian-crossing/level-crossing/phone-use, not speed), and
 * forward-geocodes each street/intersection address via Mapbox (the
 * addresses have no coordinates of their own).
 *
 * Re-run this occasionally - SAPOL adds/removes camera sites over time and
 * this repo has no way to detect that on its own.
 *
 * Usage: node scripts/buildFixedCameraDataset.js
 * Requires EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in .env (same key the app's map
 * and suburb lookup already use).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SAPOL_PAGE_URL = 'https://www.police.sa.gov.au/your-safety/road-safety/traffic-camera-locations';
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'data', 'fixedSpeedCameras.ts');

/** Only these SAPOL location types enforce speed - see the module doc comment. */
const SPEED_TYPE_MAP = {
  'mid block': 'MID_BLOCK',
  p2p: 'P2P',
  'i/section': 'INTERSECTION',
};

/** No dotenv dependency for a one-off maintenance script - just read the one line we need. */
function readMapboxTokenFromEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  const contents = fs.readFileSync(envPath, 'utf8');
  const match = contents.match(/^EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=(.*)$/m);
  if (!match || !match[1].trim()) {
    throw new Error('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN is not set in .env');
  }
  return match[1].trim();
}

const HTML_ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&#39;': "'",
  '&apos;': "'",
  '&quot;': '"',
};

function decodeHtmlEntities(text) {
  return text.replace(/&nbsp;|&amp;|&#39;|&apos;|&quot;/g, (entity) => HTML_ENTITIES[entity]);
}

function stripTags(html) {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * SAPOL addresses end with the suburb/town in caps, sometimes as a range
 * ("TWO WELLS TO PORT WAKEFIELD") for an open highway stretch rather than
 * one point. Returns the plain suburb for a normal row, or null for a range
 * row (those get geocoded best-effort with no suburb cross-check, since a
 * highway stretch has no single "correct" town to validate against).
 */
function parseExpectedSuburb(address) {
  if (/\bTO\b/.test(address)) return null;
  const match = address.match(/,?\s*([A-Z][A-Z' ]+)$/);
  return match ? match[1].trim() : null;
}

/** Case/whitespace-insensitive - "CUMBERLAND PARK" vs "Cumberland Park". */
function namesMatch(a, b) {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Parses the "Fixed camera locations" table out of the SAPOL page's raw HTML. */
function parseFixedCameraRows(html) {
  const tableMatch = html.match(/<table id="table35505"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) {
    throw new Error('Could not find the fixed-camera table (id="table35505") on the SAPOL page - it may have been restructured.');
  }

  const rowMatches = [...tableMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  const rows = [];
  for (const rowMatch of rowMatches) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => stripTags(c[1]));
    if (cells.length < 3) continue; // skips the stray blank row seen in this table
    const [locationCode, address, rawType] = cells;
    if (!locationCode || !address || !rawType) continue;
    rows.push({ locationCode, address, rawType });
  }
  return rows;
}

/**
 * Node's built-in fetch (undici) gets a 403 from SAPOL's site even with an
 * identical User-Agent to a request that succeeds - looks like WAF
 * fingerprinting below the header level (TLS/HTTP client fingerprint), not
 * anything this script's request is actually missing. Shelling out to curl
 * sidesteps it and is proven to work (verified live against this exact URL
 * while researching this feature).
 */
function fetchSapolPageHtml() {
  return execFileSync(
    'curl',
    [
      '-s',
      '-L',
      '-A',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      SAPOL_PAGE_URL,
    ],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );
}

async function fetchSapolTableRows() {
  const html = fetchSapolPageHtml();
  if (!html || html.length < 1000) {
    throw new Error('SAPOL page fetch returned unexpectedly little content - check the URL/network manually.');
  }
  return parseFixedCameraRows(html);
}

async function forwardGeocode(address, accessToken) {
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('q', `${address}, South Australia, Australia`);
  url.searchParams.set('access_token', accessToken);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Mapbox forward geocode failed (${response.status}) for "${address}"`);
  }
  const data = await response.json();
  const properties = data.features?.[0]?.properties;
  if (!properties) return null;
  return {
    position: { latitude: properties.coordinates.latitude, longitude: properties.coordinates.longitude },
    locality: properties.context?.locality?.name ?? null,
    place: properties.context?.place?.name ?? null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toTsLiteral(cameras) {
  const header = `/**
 * Generated by scripts/buildFixedCameraDataset.js from SAPOL's public
 * "Fixed camera locations" table - see that script for the full pipeline
 * and re-run instructions. Do not hand-edit; re-run the script instead.
 *
 * Only Mid Block (open-road fixed speed cameras) and P2P (point-to-point
 * average-speed cameras) and I/section (intersection combo cameras, which
 * also enforce speed) location types are included - SAPOL's PAC/Rail/MPDC
 * types enforce pedestrian-crossing/level-crossing/phone-use, not speed.
 */
import type { GeoPoint } from '../geo/types';

export type FixedSpeedCameraType = 'MID_BLOCK' | 'P2P' | 'INTERSECTION';

export interface FixedSpeedCamera {
  id: string;
  label: string;
  type: FixedSpeedCameraType;
  position: GeoPoint;
}

export const FIXED_SPEED_CAMERAS: FixedSpeedCamera[] = `;

  const body = JSON.stringify(cameras, null, 2)
    // JSON.stringify quotes keys; re-emit as plain TS object keys for readability.
    .replace(/"(\w+)":/g, '$1:');

  return `${header}${body};\n`;
}

async function main() {
  const accessToken = readMapboxTokenFromEnvFile();

  console.log('Fetching SAPOL fixed camera locations...');
  const rows = await fetchSapolTableRows();
  console.log(`Parsed ${rows.length} rows from the SAPOL table.`);

  const speedRows = rows.filter((row) => SPEED_TYPE_MAP[row.rawType.trim().toLowerCase()]);
  console.log(`${speedRows.length} rows are speed-relevant types (Mid Block/P2P/I-section).`);

  const cameras = [];
  const failures = [];
  for (let i = 0; i < speedRows.length; i++) {
    const row = speedRows[i];
    const expectedSuburb = parseExpectedSuburb(row.address);
    process.stdout.write(`Geocoding ${i + 1}/${speedRows.length}: ${row.address} ... `);
    try {
      const result = await forwardGeocode(row.address, accessToken);
      if (!result) {
        console.log('NO MATCH');
        failures.push({ ...row, reason: 'no match' });
        continue;
      }

      // Range rows ("X TO Y") have no single suburb to validate against -
      // accept best-effort. Otherwise, reject a result whose returned
      // locality/place doesn't match the suburb SAPOL's own address stated -
      // this is what caught several genuinely wrong geocodes (a stray
      // &nbsp; or an ambiguous intersection snapping to the wrong town).
      const suburbConfirmed =
        expectedSuburb === null ||
        namesMatch(expectedSuburb, result.locality) ||
        namesMatch(expectedSuburb, result.place);

      if (!suburbConfirmed) {
        console.log(`SUBURB MISMATCH (expected ${expectedSuburb}, got ${result.locality ?? result.place})`);
        failures.push({ ...row, reason: `suburb mismatch: expected ${expectedSuburb}, got ${result.locality ?? result.place}` });
        continue;
      }

      console.log(`${result.position.latitude}, ${result.position.longitude}`);
      cameras.push({
        id: `sapol-${row.locationCode}`,
        label: row.address,
        type: SPEED_TYPE_MAP[row.rawType.trim().toLowerCase()],
        position: result.position,
      });
    } catch (error) {
      console.log(`ERROR: ${error.message}`);
      failures.push({ ...row, reason: error.message });
    }
    // Stay well under Mapbox's rate limits - this is a one-off script, not a hot path.
    await sleep(150);
  }

  fs.writeFileSync(OUTPUT_PATH, toTsLiteral(cameras));
  console.log(`\nWrote ${cameras.length} cameras to ${OUTPUT_PATH}`);
  if (failures.length > 0) {
    console.log(`${failures.length} addresses were skipped (failed to geocode or failed suburb validation):`);
    for (const row of failures) {
      console.log(`  - [${row.locationCode}] ${row.address} (${row.rawType}) - ${row.reason}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
