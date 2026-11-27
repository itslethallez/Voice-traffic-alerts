#!/usr/bin/env node
/**
 * Maintainer tool (not scheduled): rebuilds
 * scripts/data/sapol-camera-placements.json - the OpenStreetMap-derived
 * position of every SAPOL speed-camera site - see
 * scripts/scrapers/lib/cameraPlacement.js for why placements are
 * computed from OSM and committed rather than geocoded every week.
 *
 * Two Overpass queries in total (suburb bounds, then every named road
 * inside those bounds); everything else is computed locally. Public
 * Overpass servers can take minutes per query - that is expected here.
 *
 * Usage:
 *   node scripts/buildFixedCameraPlacements.js [--html saved-sapol-page.html]
 * Without --html it fetches the SAPOL page via ScraperAPI (SCRAPERAPI_KEY).
 * Rows already in the JSON keep their entry unless --all is passed.
 */

const fs = require('fs');
const path = require('path');
const { parseFixedCameraRows, fetchSapolTableRows, SPEED_TYPE_MAP } = require('./buildFixedCameraDataset');
const { parseCameraAddress, suburbKey, placeFromOsm, expandRoadName } = require('./scrapers/lib/cameraPlacement');

const PLACEMENTS_PATH = path.join(__dirname, 'data', 'sapol-camera-placements.json');
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
/** ~3 km of padding around a suburb's bounds when collecting its roads. */
const ROAD_PAD_DEG = 0.03;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function overpass(query) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'shotgun-camera-placements/1.0' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(600_000),
      });
      if (response.ok) return await response.json();
      console.warn(`[cameras] overpass ${endpoint} -> ${response.status}, retrying`);
    } catch (error) {
      console.warn(`[cameras] overpass ${endpoint} -> ${error.message}, retrying`);
    }
    await sleep(Math.min(60_000, 5_000 * (attempt + 1)));
  }
  throw new Error('Overpass unavailable after 12 attempts');
}

function regexEscape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleCase(text) {
  return text.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

async function loadRows(htmlPath) {
  const rows = htmlPath ? parseFixedCameraRows(fs.readFileSync(htmlPath, 'utf8')) : await fetchSapolTableRows();
  const seen = new Set();
  return rows.filter((row) => {
    if (!SPEED_TYPE_MAP[row.rawType.trim().toLowerCase()] || seen.has(row.locationCode)) return false;
    seen.add(row.locationCode);
    return true;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const htmlIndex = args.indexOf('--html');
  const rows = await loadRows(htmlIndex >= 0 ? args[htmlIndex + 1] : null);
  const existing = fs.existsSync(PLACEMENTS_PATH) ? JSON.parse(fs.readFileSync(PLACEMENTS_PATH, 'utf8')) : { sites: {}, suburbs: {} };
  const todo = args.includes('--all') ? rows : rows.filter((row) => !existing.sites[row.locationCode]);
  console.log(`[cameras] ${rows.length} speed sites, ${todo.length} to place`);

  const parsedRows = todo.map((row) => ({ row, parsed: parseCameraAddress(row.address) }));
  const suburbNames = [...new Set(parsedRows.flatMap(({ parsed }) => parsed?.suburbs ?? []))];

  console.log(`[cameras] fetching bounds for ${suburbNames.length} suburbs...`);
  const suburbData = await overpass(
    `[out:json][timeout:600];area["name"="South Australia"]["admin_level"="4"]->.sa;` +
      `rel(area.sa)["boundary"="administrative"]["admin_level"~"^(9|10)$"]["name"~"^(${suburbNames
        .map((n) => regexEscape(titleCase(n)))
        .join('|')})$",i];out tags bb;`,
  );
  const suburbs = { ...existing.suburbs };
  for (const element of suburbData.elements) {
    const key = suburbKey(element.tags.name);
    if (suburbs[key] && !existing.suburbs[key]) console.warn(`[cameras] two SA localities named ${element.tags.name} - keeping the first`);
    if (suburbs[key] && !existing.suburbs[key]) continue;
    suburbs[key] = {
      name: element.tags.name,
      minLat: element.bounds.minlat,
      minLng: element.bounds.minlon,
      maxLat: element.bounds.maxlat,
      maxLng: element.bounds.maxlon,
    };
  }

  const clauses = [];
  for (const { parsed } of parsedRows) {
    if (!parsed) continue;
    const bounds = parsed.suburbs.map((s) => suburbs[suburbKey(s)]).filter(Boolean);
    if (bounds.length === 0) continue;
    const s = Math.min(...bounds.map((b) => b.minLat)) - ROAD_PAD_DEG;
    const w = Math.min(...bounds.map((b) => b.minLng)) - ROAD_PAD_DEG;
    const n = Math.max(...bounds.map((b) => b.maxLat)) + ROAD_PAD_DEG;
    const e = Math.max(...bounds.map((b) => b.maxLng)) + ROAD_PAD_DEG;
    const names = parsed.roads.map((r) => regexEscape(expandRoadName(r))).join('|');
    clauses.push(`way["highway"]["name"~"^(${names})$",i](${s},${w},${n},${e});`);
  }
  console.log(`[cameras] fetching road geometry (${clauses.length} areas)...`);
  const roadData = await overpass(`[out:json][timeout:900];(${[...new Set(clauses)].join('')});out body geom;`);
  const ways = roadData.elements
    .filter((el) => el.type === 'way' && el.geometry)
    .map((el) => ({
      name: el.tags.name,
      nodes: el.nodes,
      geometry: el.geometry.map((g) => ({ latitude: g.lat, longitude: g.lon })),
    }));
  console.log(`[cameras] ${ways.length} road ways`);

  const sites = { ...existing.sites };
  const failures = [];
  for (const { row, parsed } of parsedRows) {
    if (!parsed) {
      failures.push(`[${row.locationCode}] ${row.address} - cannot parse road/suburb`);
      continue;
    }
    const bounds = parsed.suburbs.map((s) => suburbs[suburbKey(s)]);
    if (bounds.some((b) => !b)) {
      failures.push(`[${row.locationCode}] ${row.address} - suburb not found in OSM`);
      continue;
    }
    const pad = (b) => ({ minLat: b.minLat - ROAD_PAD_DEG, minLng: b.minLng - ROAD_PAD_DEG, maxLat: b.maxLat + ROAD_PAD_DEG, maxLng: b.maxLng + ROAD_PAD_DEG });
    const inArea = (way) =>
      way.geometry.some((p) =>
        bounds.map(pad).some((b) => p.latitude >= b.minLat && p.latitude <= b.maxLat && p.longitude >= b.minLng && p.longitude <= b.maxLng),
      );
    const result = placeFromOsm(parsed, ways.filter(inArea), bounds);
    if (result.failure) {
      failures.push(`[${row.locationCode}] ${row.address} - ${result.failure}`);
      continue;
    }
    sites[row.locationCode] = { address: row.address, ...result.position, method: result.method };
    console.log(`[cameras] ${row.locationCode} ${row.address} -> ${result.position.latitude}, ${result.position.longitude} (${result.method})`);
  }

  const sortedSites = Object.fromEntries(Object.entries(sites).sort(([a], [b]) => Number(a) - Number(b)));
  const sortedSuburbs = Object.fromEntries(Object.entries(suburbs).sort(([a], [b]) => a.localeCompare(b)));
  fs.mkdirSync(path.dirname(PLACEMENTS_PATH), { recursive: true });
  fs.writeFileSync(
    PLACEMENTS_PATH,
    `${JSON.stringify({ source: 'OpenStreetMap contributors (ODbL), via Overpass', sites: sortedSites, suburbs: sortedSuburbs }, null, 2)}\n`,
  );
  console.log(`[cameras] wrote ${Object.keys(sortedSites).length} placements`);
  if (failures.length > 0) {
    console.log(`[cameras] ${failures.length} could not be placed:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
