#!/usr/bin/env node
/**
 * One-off ingest of SA's posted speed limits into the `speed_limits`
 * table. Source: the DIT "Speed Zones" MapServer that backs the
 * data.sa.gov.au open-data catalogue (Location SA spatial services) -
 * layer 12, "Speed Limits", ~8.3k road-segment polylines with RDNAME +
 * SPEED_LIMIT. There's no flat CSV/GeoJSON download for this dataset;
 * the ArcGIS REST query endpoint is the published API.
 *
 * Run once, then re-run manually when the dataset updates (DIT republish
 * the layer periodically; nothing detects that automatically). NOT
 * scheduled - matching the deliberate/manual cadence in the header of
 * buildFixedCameraDataset.js's early days.
 *
 *   node scripts/loadSpeedLimits.js
 *
 * Env:
 *   SCRAPERAPI_KEY (root .env) - location.sa.gov.au sits behind
 *     CloudFront and 403s datacenter IPs; same proxy the SAPOL scrapers
 *     use (standard pool is enough, observed Sep 2026).
 *   DATABASE_URL (server/.env) - a Neon BRANCH connection string. This
 *     script refuses to run if the value is literally the prod string
 *     from the repo-root .env (same guard as server/e2e/ingest-live).
 *     For a deliberate prod load, point server/.env at prod on purpose.
 */

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const { fetchViaScraperApi } = require('./scrapers/lib/scraperApi');

const LAYER_URL =
  'https://location.sa.gov.au/server6/rest/services/Transport/Speed_Zones/MapServer/12/query';
const SOURCE = 'dit_speed_zones';
const PAGE_SIZE = 1000; // server MaxRecordCount
const INSERT_BATCH = 500;

function readEnvValueFrom(file, key) {
  const envPath = path.join(__dirname, '..', file);
  if (!fs.existsSync(envPath)) return undefined;
  const match = fs.readFileSync(envPath, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match?.[1].trim() || undefined;
}

/** DATABASE_URL comes from server/.env and must be a branch string -
 * see the module header and .windsurfrules "Dev environment". */
function branchDatabaseUrl() {
  const url = readEnvValueFrom(path.join('server', '.env'), 'DATABASE_URL');
  if (!url) throw new Error('DATABASE_URL is not set in server/.env');
  const prodUrl = readEnvValueFrom('.env', 'DATABASE_URL');
  if (prodUrl && url === prodUrl) {
    throw new Error(
      'server/.env DATABASE_URL is the PROD string from the root .env - refusing to run. Use a Neon branch (or point server/.env at prod deliberately).'
    );
  }
  return url;
}

async function queryLayer(params) {
  const url = `${LAYER_URL}?f=json&outSR=4326&${params}`;
  const body = await fetchViaScraperApi(url);
  const json = JSON.parse(body);
  if (json.error) throw new Error(`ArcGIS query failed: ${JSON.stringify(json.error).slice(0, 300)}`);
  return json;
}

async function fetchAllFeatures() {
  const { count } = await queryLayer('where=1%3D1&returnCountOnly=true');
  console.log(`Layer reports ${count} feature(s).`);

  const features = [];
  for (let offset = 0; offset < count; offset += PAGE_SIZE) {
    const page = await queryLayer(
      'where=1%3D1' +
        '&outFields=OBJECTID,RDNAME,SPEED_LIMIT,SIDE,START_RRD,END_RRD' +
        '&orderByFields=OBJECTID' +
        `&resultOffset=${offset}&resultRecordCount=${PAGE_SIZE}` +
        '&returnGeometry=true'
    );
    const batch = page.features ?? [];
    features.push(...batch);
    console.log(`  fetched ${features.length}/${count}`);
    if (batch.length < PAGE_SIZE) break;
  }
  return features;
}

/** ArcGIS rings/paths are [lng, lat] pairs; geometry.paths may hold
 * several disjoint segments -> always emit MULTILINESTRING so the column
 * type stays uniform. Returns null when the feature has no usable path. */
function toMultiLineStringWkt(paths) {
  const usable = (paths ?? []).filter((p) => Array.isArray(p) && p.length >= 2);
  if (usable.length === 0) return null;
  const parts = usable.map(
    (path) => `(${path.map(([lng, lat]) => `${lng} ${lat}`).join(', ')})`
  );
  return `SRID=4326;MULTILINESTRING(${parts.join(', ')})`;
}

function toRows(features) {
  const rows = [];
  let skipped = 0;
  for (const feature of features) {
    const attrs = feature.attributes ?? {};
    const limit = Number(attrs.SPEED_LIMIT);
    const wkt = toMultiLineStringWkt(feature.geometry?.paths);
    if (!attrs.OBJECTID || !Number.isFinite(limit) || limit <= 0 || !wkt) {
      skipped += 1;
      continue;
    }
    rows.push({
      id: `dit-${attrs.OBJECTID}`,
      geom: wkt,
      road_name: String(attrs.RDNAME ?? '').trim() || 'UNKNOWN',
      speed_limit_kmh: limit,
      side: attrs.SIDE ?? null,
    });
  }
  if (skipped > 0) console.warn(`Skipped ${skipped} feature(s) with no geometry or no valid speed limit.`);
  return rows;
}

/** Batched upsert via unnest - one HTTP round-trip per 500 rows instead
 * of one per row (~17 total for ~8.3k features). */
async function upsertRows(sql, rows) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    await sql`
      INSERT INTO speed_limits (id, geom, road_name, speed_limit_kmh, side, source, last_synced_at)
      SELECT
        u.id,
        ST_GeogFromText(u.geom),
        u.road_name,
        u.speed_limit_kmh::smallint,
        u.side,
        ${SOURCE},
        now()
      FROM unnest(
        ${batch.map((r) => r.id)}::text[],
        ${batch.map((r) => r.geom)}::text[],
        ${batch.map((r) => r.road_name)}::text[],
        ${batch.map((r) => r.speed_limit_kmh)}::int[],
        ${batch.map((r) => r.side)}::text[]
      ) AS u(id, geom, road_name, speed_limit_kmh, side)
      ON CONFLICT (id) DO UPDATE SET
        geom = EXCLUDED.geom,
        road_name = EXCLUDED.road_name,
        speed_limit_kmh = EXCLUDED.speed_limit_kmh,
        side = EXCLUDED.side,
        source = EXCLUDED.source,
        last_synced_at = now()
    `;
    process.stdout.write(`\r  upserted ${Math.min(i + INSERT_BATCH, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');
}

/** Same empty-result guard as the other ingest jobs: a run that fetched
 * zero rows must never be read as "DIT removed every speed limit". */
async function deleteStaleRows(sql, currentIds) {
  if (currentIds.length === 0) {
    console.warn('No rows were fetched this run - skipping stale-row cleanup.');
    return 0;
  }
  const stale = await sql`SELECT id FROM speed_limits WHERE source = ${SOURCE} AND id != ALL(${currentIds})`;
  if (stale.length === 0) return 0;
  await sql`DELETE FROM speed_limits WHERE source = ${SOURCE} AND id != ALL(${currentIds})`;
  return stale.length;
}

async function main() {
  const sql = neon(branchDatabaseUrl());

  console.log('Fetching DIT Speed Zones layer via ScraperAPI...');
  const features = await fetchAllFeatures();
  const rows = toRows(features);
  console.log(`Upserting ${rows.length} speed-limit segment(s) into speed_limits...`);
  await upsertRows(sql, rows);
  const removed = await deleteStaleRows(sql, rows.map((r) => r.id));
  console.log(`Done: ${rows.length} upserted${removed > 0 ? `, ${removed} stale row(s) removed` : ''}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
