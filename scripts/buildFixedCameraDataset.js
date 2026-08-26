#!/usr/bin/env node
/**
 * Ingests SAPOL's own public "Fixed camera locations" table into the
 * central `fixed_cameras` table (Central Database brief) - previously this
 * regenerated src/data/fixedSpeedCameras.ts as a bundled TS literal
 * instead; that file remains as tripRuntime.ts's offline fallback, but is
 * no longer written by this script. There is no downloadable CSV/API for
 * this data - it only exists as an HTML table on
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
 * Requires EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN (same key the app's map and
 * suburb lookup already use) and DATABASE_URL (the server/ Neon
 * connection string - never the mobile app's own env vars) in .env.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { neon } = require('@neondatabase/serverless');

const SAPOL_PAGE_URL = 'https://www.police.sa.gov.au/your-safety/road-safety/traffic-camera-locations';

/** Only these SAPOL location types enforce speed - see the module doc comment. */
const SPEED_TYPE_MAP = {
  'mid block': 'MID_BLOCK',
  p2p: 'P2P',
  'i/section': 'INTERSECTION',
};

/** No dotenv dependency for a one-off maintenance script - just read the one line we need. */
function readEnvValue(key) {
  const envPath = path.join(__dirname, '..', '.env');
  const contents = fs.readFileSync(envPath, 'utf8');
  const match = contents.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match || !match[1].trim()) {
    throw new Error(`${key} is not set in .env`);
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

/**
 * Every SAPOL fixed-enforcement location type (Mid Block/P2P/I-section)
 * collapses to the single 'fixed' camera_type the central schema
 * distinguishes from 'mobile_zone' (SAPOL's separately-sourced mobile
 * speed camera zones, not handled by this script) - see server/schema.sql.
 */
async function upsertCameras(sql, cameras) {
  for (const camera of cameras) {
    await sql`
      INSERT INTO fixed_cameras (id, lat, lng, road_name, camera_type, source, last_synced_at)
      VALUES (${camera.id}, ${camera.position.latitude}, ${camera.position.longitude}, ${camera.label}, 'fixed', 'sapol', now())
      ON CONFLICT (id) DO UPDATE SET
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        road_name = EXCLUDED.road_name,
        camera_type = EXCLUDED.camera_type,
        source = EXCLUDED.source,
        last_synced_at = now()
    `;
  }
}

/** Removes any previously-ingested SAPOL row not present in this run's
 * scrape - mirrors the old approach's implicit "whole file regenerated"
 * behaviour for sites SAPOL has since removed. Never touches rows from
 * other sources (e.g. a future TomTom mobile_zone ingest). */
async function deleteStaleCameras(sql, currentIds) {
  if (currentIds.length === 0) {
    // Postgres' `!= ALL(array)` against an *empty* array is vacuously true
    // for every row, so an empty currentIds list would otherwise match (and
    // delete) every SAPOL row in the table. A run that geocoded zero
    // cameras - SAPOL's page format changed, Mapbox had an outage, every
    // row failed suburb validation - must never be allowed to wipe the
    // whole existing dataset just because the upsert above was a no-op.
    console.warn('No cameras were geocoded this run - skipping stale-row cleanup to avoid deleting the entire dataset.');
    return 0;
  }
  const staleRows = await sql`
    SELECT id FROM fixed_cameras WHERE source = 'sapol' AND id != ALL(${currentIds})
  `;
  if (staleRows.length === 0) return 0;
  await sql`DELETE FROM fixed_cameras WHERE source = 'sapol' AND id != ALL(${currentIds})`;
  return staleRows.length;
}

async function main() {
  const accessToken = readEnvValue('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN');
  const databaseUrl = readEnvValue('DATABASE_URL');
  const sql = neon(databaseUrl);

  console.log('Fetching SAPOL fixed camera locations...');
  const rows = await fetchSapolTableRows();
  console.log(`Parsed ${rows.length} rows from the SAPOL table.`);

  const speedRowsWithDupes = rows.filter((row) => SPEED_TYPE_MAP[row.rawType.trim().toLowerCase()]);
  console.log(`${speedRowsWithDupes.length} rows are speed-relevant types (Mid Block/P2P/I-section).`);

  // SAPOL's table lists the same physical location (locationCode) more than
  // once for some entries - geocoding both just produces two identical
  // FixedSpeedCamera records with the same generated id, which duplicates
  // work on every GPS update in selectSpeedCameraWarning.ts for no benefit.
  const seenLocationCodes = new Set();
  const speedRows = speedRowsWithDupes.filter((row) => {
    if (seenLocationCodes.has(row.locationCode)) return false;
    seenLocationCodes.add(row.locationCode);
    return true;
  });
  if (speedRows.length !== speedRowsWithDupes.length) {
    console.log(
      `Deduplicated ${speedRowsWithDupes.length - speedRows.length} row(s) sharing a location code with an earlier row.`
    );
  }

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

  console.log(`\nUpserting ${cameras.length} cameras into fixed_cameras...`);
  await upsertCameras(sql, cameras);
  const removed = await deleteStaleCameras(sql, cameras.map((c) => c.id));
  console.log(`Upserted ${cameras.length} cameras${removed > 0 ? `, removed ${removed} no-longer-listed SAPOL row(s)` : ''}.`);
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
