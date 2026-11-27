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
 * enforce pedestrian-crossing/level-crossing/phone-use, not speed).
 *
 * Positions: the addresses have no coordinates. Each site's position
 * comes from scripts/data/sapol-camera-placements.json (OpenStreetMap
 * junction / road geometry, built by scripts/buildFixedCameraPlacements.js);
 * a site SAPOL added since then falls back to Mapbox. EVERY camera must
 * pass the 5 km check (scripts/scrapers/lib/cameraPlacement.js: named
 * road(s) and suburb within 5 km) or it is not written, and the run goes
 * red + reports to Sentry listing what was skipped - then rebuild the
 * placements file to pick the new site up.
 *
 * Runs weekly via .github/workflows/refresh-fixed-cameras.yml.
 *
 * Usage: node scripts/buildFixedCameraDataset.js [--dry-run] [--write-fallback] [--html saved.html]
 *   --dry-run         place + check only, never touches the database
 *   --write-fallback  also regenerate src/data/fixedSpeedCameras.ts
 * Requires EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN, SCRAPERAPI_KEY (unless --html)
 * and DATABASE_URL (unless --dry-run) in .env. Run against prod only from
 * the workflow - never locally.
 */

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const { fetchViaScraperApi } = require('./scrapers/lib/scraperApi');
const { readEnvValue } = require('./scrapers/lib/env');
const { reportJobFailure } = require('./scrapers/lib/sentryReporter');
const { MAX_OFFSET_KM, parseCameraAddress, suburbKey, checkPlacement } = require('./scrapers/lib/cameraPlacement');

const PLACEMENTS_PATH = path.join(__dirname, 'data', 'sapol-camera-placements.json');

const SAPOL_PAGE_URL = 'https://www.police.sa.gov.au/your-safety/road-safety/traffic-camera-locations';

/** Only these SAPOL location types enforce speed - see the module doc comment. */
const SPEED_TYPE_MAP = {
  'mid block': 'MID_BLOCK',
  p2p: 'P2P',
  'i/section': 'INTERSECTION',
};

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
 * identical User-Agent to a request that succeeds from a residential IP -
 * looks like WAF IP-range blocking (datacenter/cloud ranges, which is what
 * both a local curl-from-devbox *and* GitHub Actions runners increasingly
 * fall under) rather than anything about the request itself. Shelling out
 * to curl locally used to sidestep it, but GitHub Actions' shared runner
 * IPs started getting blocked too (this is what broke the scheduled
 * workflow - see git history around late Aug/early Sep 2026), so this now
 * routes through ScraperAPI (https://www.scraperapi.com, free tier: 1,000
 * requests/month, no card - this script runs weekly, so usage is
 * negligible). It originally used premium=true (residential pool), but
 * the free plan has no premium access, so it now goes through the shared
 * fetchViaScraperApi helper: Australian exit IPs, standard pool with
 * free retries, premium as a last attempt.
 *
 * Requires SCRAPERAPI_KEY in .env (or the SCRAPERAPI_KEY secret in CI).
 */
async function fetchSapolPageHtml() {
  return fetchViaScraperApi(SAPOL_PAGE_URL);
}

async function fetchSapolTableRows() {
  const html = await fetchSapolPageHtml();
  if (!html || html.length < 1000) {
    throw new Error('SAPOL page fetch returned unexpectedly little content - check the URL/network manually.');
  }
  return parseFixedCameraRows(html);
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
 * identical User-Agent to a request that succeeds from a residential IP -
 * looks like WAF IP-range blocking (datacenter/cloud ranges, which is what
 * both a local curl-from-devbox *and* GitHub Actions runners increasingly
 * fall under) rather than anything about the request itself. Shelling out
 * to curl locally used to sidestep it, but GitHub Actions' shared runner
 * IPs started getting blocked too (this is what broke the scheduled
 * workflow - see git history around late Aug/early Sep 2026), so this now
 * routes through ScraperAPI (https://www.scraperapi.com, free tier: 1,000
 * requests/month, no card - this script runs weekly, so usage is
 * negligible). It originally used premium=true (residential pool), but
 * the free plan has no premium access, so it now goes through the shared
 * fetchViaScraperApi helper: Australian exit IPs, standard pool with
 * free retries, premium as a last attempt.
 *
 * Requires SCRAPERAPI_KEY in .env (or the SCRAPERAPI_KEY secret in CI).
 */
async function fetchSapolPageHtml() {
  return fetchViaScraperApi(SAPOL_PAGE_URL);
}

async function fetchSapolTableRows() {
  const html = await fetchSapolPageHtml();
  if (!html || html.length < 1000) {
    throw new Error('SAPOL page fetch returned unexpectedly little content - check the URL/network manually.');
  }
  return parseFixedCameraRows(html);
}

/**
 * Fallback for a site that is not in scripts/data/sapol-camera-placements.json
 * yet (SAPOL added it since the table was last rebuilt). Restricted to
 * street results inside South Australia's bbox, biased to the suburb -
 * but still only a fallback: Mapbox has no intersection search, so the
 * 5 km check decides whether the result is kept.
 */
const SA_BBOX = '129.0,-38.1,141.0,-25.9';
async function mapboxForward(query, accessToken, { types, proximity } = {}) {
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('q', query);
  url.searchParams.set('country', 'au');
  url.searchParams.set('bbox', SA_BBOX);
  if (types) url.searchParams.set('types', types);
  if (proximity) url.searchParams.set('proximity', `${proximity.longitude},${proximity.latitude}`);
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Mapbox forward geocode failed (${response.status}) for "${query}"`);
  const data = await response.json();
  return data.features?.[0]?.properties ?? null;
}

async function mapboxSuburbBounds(suburb, accessToken) {
  const properties = await mapboxForward(`${suburb}, South Australia`, accessToken, { types: 'locality' });
  if (!properties || suburbKey(properties.name) !== suburbKey(suburb) || !properties.bbox) return null;
  const [minLng, minLat, maxLng, maxLat] = properties.bbox;
  return { name: properties.name, minLat, minLng, maxLat, maxLng };
}

async function mapboxPlace(parsed, suburbBounds, accessToken) {
  const first = suburbBounds[0];
  const centre = first ? { latitude: (first.minLat + first.maxLat) / 2, longitude: (first.minLng + first.maxLng) / 2 } : null;
  const properties = await mapboxForward(`${parsed.roads[0]}, ${parsed.suburbs[0]}, South Australia`, accessToken, {
    types: 'street',
    proximity: centre,
  });
  if (!properties) return null;
  return { latitude: properties.coordinates.latitude, longitude: properties.coordinates.longitude };
}

/** Road names Mapbox's streets tileset has within MAX_OFFSET_KM of a point (nearest 50 features). */
async function roadNamesNear(position, accessToken) {
  const url = new URL(
    `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${position.longitude},${position.latitude}.json`,
  );
  url.searchParams.set('radius', String(MAX_OFFSET_KM * 1000));
  url.searchParams.set('layers', 'road');
  url.searchParams.set('limit', '50');
  url.searchParams.set('dedupe', 'true');
  url.searchParams.set('access_token', accessToken);
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url.toString());
    if (response.ok) {
      const data = await response.json();
      return data.features.map((f) => f.properties?.name).filter(Boolean);
    }
    if (attempt === 2) throw new Error(`Mapbox tilequery failed (${response.status})`);
    await sleep(1000 * (attempt + 1));
  }
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

/**
 * Removes every SAPOL row not written this run - sites SAPOL has
 * removed, and sites that failed placement or the 5 km check (a camera
 * pinned in the wrong place warns about nothing and teaches drivers to
 * ignore warnings). Never touches other sources. main()'s
 * MIN_PASS_RATIO guard means an outage can never wipe the dataset.
 */
async function deleteUnwrittenCameras(sql, writtenIds) {
  const staleRows = await sql`
    SELECT id FROM fixed_cameras WHERE source = 'sapol' AND id != ALL(${writtenIds})
  `;
  if (staleRows.length === 0) return 0;
  await sql`DELETE FROM fixed_cameras WHERE source = 'sapol' AND id != ALL(${writtenIds})`;
  return staleRows.length;
}

/** Regenerates src/data/fixedSpeedCameras.ts (the app's offline fallback), same shape as before. */
function writeFallbackFile(cameras) {
  const filePath = path.join(__dirname, '..', 'src', 'data', 'fixedSpeedCameras.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const header = source.slice(0, source.indexOf('export const FIXED_SPEED_CAMERAS'));
  const body = cameras
    .map((c) => ({ id: c.id, label: c.label, position: c.position }))
    .sort((a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));
  fs.writeFileSync(filePath, `${header}export const FIXED_SPEED_CAMERAS: FixedSpeedCamera[] = ${JSON.stringify(body, null, 2)};\n`);
  console.log(`[cameras] wrote ${body.length} cameras to src/data/fixedSpeedCameras.ts`);
}

/** If fewer than this share of sites pass, assume an outage/page change and write nothing. */
const MIN_PASS_RATIO = 0.75;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const writeFallback = args.includes('--write-fallback');
  const htmlIndex = args.indexOf('--html');
  const accessToken = readEnvValue('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN');
  const sql = dryRun ? null : neon(readEnvValue('DATABASE_URL'));
  const placements = JSON.parse(fs.readFileSync(PLACEMENTS_PATH, 'utf8'));

  console.log('[cameras] fetching SAPOL fixed camera locations...');
  const rows = htmlIndex >= 0 ? parseFixedCameraRows(fs.readFileSync(args[htmlIndex + 1], 'utf8')) : await fetchSapolTableRows();
  console.log(`[cameras] parsed ${rows.length} rows from the SAPOL table`);

  // SAPOL lists some location codes twice - keep the first.
  const seenLocationCodes = new Set();
  const speedRows = rows.filter((row) => {
    if (!SPEED_TYPE_MAP[row.rawType.trim().toLowerCase()] || seenLocationCodes.has(row.locationCode)) return false;
    seenLocationCodes.add(row.locationCode);
    return true;
  });
  console.log(`[cameras] ${speedRows.length} speed sites (Mid Block/P2P/I-section)`);

  const cameras = [];
  const failures = [];
  for (const row of speedRows) {
    const parsed = parseCameraAddress(row.address);
    const label = `[${row.locationCode}] ${row.address}`;
    try {
      if (!parsed) throw new Error('cannot parse road/suburb');
      const suburbBounds = [];
      for (const suburb of parsed.suburbs) {
        suburbBounds.push(placements.suburbs[suburbKey(suburb)] ?? (await mapboxSuburbBounds(suburb, accessToken)));
      }

      const curated = placements.sites[row.locationCode];
      let position;
      let method;
      if (curated && curated.address === row.address) {
        position = { latitude: curated.latitude, longitude: curated.longitude };
        method = curated.method;
      } else {
        position = await mapboxPlace(parsed, suburbBounds, accessToken);
        method = curated ? 'mapbox - SAPOL changed the address, rebuild placements' : 'mapbox - new site, rebuild placements';
        if (!position) throw new Error('no Mapbox match');
      }

      const camera = { id: `sapol-${row.locationCode}`, label: row.address, position };
      const problems = checkPlacement(camera, parsed, await roadNamesNear(position, accessToken), suburbBounds);
      if (problems.length > 0) throw new Error(`failed 5 km check (${method}): ${problems.join('; ')}`);
      cameras.push(camera);
      console.log(`[cameras] ok ${label} -> ${position.latitude}, ${position.longitude} (${method})`);
    } catch (error) {
      console.log(`[cameras] SKIP ${label} - ${error.message}`);
      failures.push(`${label} - ${error.message}`);
    }
    await sleep(100); // well under Mapbox rate limits
  }

  const passRatio = speedRows.length === 0 ? 0 : cameras.length / speedRows.length;
  if (passRatio < MIN_PASS_RATIO) {
    throw new Error(
      `only ${cameras.length}/${speedRows.length} sites passed - writing nothing (outage or SAPOL page change?). First failures: ${failures.slice(0, 5).join(' | ')}`,
    );
  }

  if (writeFallback) writeFallbackFile(cameras);
  if (dryRun) {
    console.log(`[cameras] dry run: ${cameras.length} would be written, ${failures.length} skipped`);
  } else {
    await upsertCameras(sql, cameras);
    const removed = await deleteUnwrittenCameras(sql, cameras.map((c) => c.id));
    console.log(`[cameras] upserted ${cameras.length}${removed > 0 ? `, removed ${removed} unwritten SAPOL row(s)` : ''}`);
  }

  if (failures.length > 0) {
    const message = `${failures.length} SAPOL camera site(s) skipped:\n${failures.join('\n')}`;
    console.log(message);
    await reportJobFailure('refresh-fixed-cameras', new Error(message));
    // A red run emails the owner even without Sentry. The good sites are already written.
    process.exitCode = 1;
  }
}

module.exports = { parseFixedCameraRows, fetchSapolTableRows, SPEED_TYPE_MAP };

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error);
    await reportJobFailure('refresh-fixed-cameras', error);
    process.exit(1);
  });
}
