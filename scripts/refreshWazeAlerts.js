#!/usr/bin/env node
/**
 * Mirrors OpenWeb Ninja's live Waze alerts into the central `waze_alerts`
 * table, on a schedule (GitHub Actions, not Vercel Cron - kept consistent
 * with buildFixedCameraDataset.js's own reasoning: this repo has no linked
 * Vercel project to reason about cron-frequency limits against, and a
 * plain scheduled workflow needs no such assumption).
 *
 * This does NOT change how the app itself gets Waze data - src/api/waze/client.ts
 * still polls OpenWeb Ninja directly per device, per trip, unchanged. This
 * script's only job is to keep a second, continuously-refreshed copy of
 * the same data sitting in the central database, independent of any one
 * device being on a trip.
 *
 * Usage: node scripts/refreshWazeAlerts.js
 * Requires EXPO_PUBLIC_WAZE_API_KEY (the same OpenWeb Ninja key the app
 * uses) and DATABASE_URL (the server/ Neon connection string) in .env.
 */

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

const WAZE_ALERTS_URL = 'https://api.openwebninja.com/waze/alerts-and-jams';

/**
 * Covers all of South Australia, matching the extent of the SAPOL fixed
 * camera dataset this same scripts/ directory ingests (roughly lat -37.85
 * to -32.48, lng 137.56 to 140.94) rather than just Adelaide metro, padded
 * slightly. The API caps a single request at 200 alerts - a box this size
 * risks truncation during a busy Adelaide peak even though the rest of the
 * state is sparse, but splitting into a quadrant grid (like the app's own
 * moving/stationary poll boxes do at trip scale) is deliberately left for
 * later: this logs a warning when a response looks truncated rather than
 * guessing at a grid nobody's validated against real traffic volume yet.
 */
const STATE_BOUNDING_BOX = {
  bottom_left: '-38.1,137.3',
  top_right: '-32.2,141.2',
};

const MAX_ALERTS = 200;

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

async function fetchWazeAlerts(apiKey) {
  const url = new URL(WAZE_ALERTS_URL);
  url.searchParams.set('bottom_left', STATE_BOUNDING_BOX.bottom_left);
  url.searchParams.set('top_right', STATE_BOUNDING_BOX.top_right);
  url.searchParams.set('max_alerts', String(MAX_ALERTS));
  url.searchParams.set('max_jams', '0');

  const response = await fetch(url.toString(), {
    headers: { 'x-api-key': apiKey },
  });
  if (!response.ok) {
    throw new Error(`Waze API request failed with status ${response.status}`);
  }
  const body = await response.json();
  return body.data?.alerts ?? [];
}

async function upsertAlerts(sql, alerts) {
  for (const alert of alerts) {
    await sql`
      INSERT INTO waze_alerts (
        id, type, subtype, lat, lng, street, city,
        reported_at, reliability, confidence, num_thumbs_up,
        first_seen_at, last_seen_at
      )
      VALUES (
        ${alert.alert_id}, ${alert.type}, ${alert.subtype}, ${alert.latitude}, ${alert.longitude},
        ${alert.street}, ${alert.city}, ${alert.publish_datetime_utc},
        ${alert.alert_reliability}, ${alert.alert_confidence}, ${alert.num_thumbs_up},
        now(), now()
      )
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        subtype = EXCLUDED.subtype,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        street = EXCLUDED.street,
        city = EXCLUDED.city,
        reported_at = EXCLUDED.reported_at,
        reliability = EXCLUDED.reliability,
        confidence = EXCLUDED.confidence,
        num_thumbs_up = EXCLUDED.num_thumbs_up,
        last_seen_at = now()
    `;
  }
}

/** Removes rows no run has re-seen (i.e. Waze no longer reports them) in
 * this long - mirrors buildFixedCameraDataset.js's own stale-row cleanup,
 * with the same empty-result guard: a run that fetched zero alerts (API
 * outage, bad response) must never be read as "everything expired". */
async function deleteStaleAlerts(sql, seenIds) {
  if (seenIds.length === 0) {
    console.warn('No alerts were fetched this run - skipping stale-row cleanup.');
    return 0;
  }
  const staleRows = await sql`
    SELECT id FROM waze_alerts WHERE id != ALL(${seenIds}) AND last_seen_at < now() - interval '30 minutes'
  `;
  if (staleRows.length === 0) return 0;
  await sql`DELETE FROM waze_alerts WHERE id != ALL(${seenIds}) AND last_seen_at < now() - interval '30 minutes'`;
  return staleRows.length;
}

async function main() {
  const apiKey = readEnvValue('EXPO_PUBLIC_WAZE_API_KEY');
  const databaseUrl = readEnvValue('DATABASE_URL');
  const sql = neon(databaseUrl);

  console.log('Fetching live Waze alerts for South Australia...');
  const alerts = await fetchWazeAlerts(apiKey);
  console.log(`Fetched ${alerts.length} alert(s).`);
  if (alerts.length >= MAX_ALERTS) {
    console.warn(
      `Response returned the max_alerts cap (${MAX_ALERTS}) - this run likely missed alerts. Consider splitting STATE_BOUNDING_BOX into a grid.`
    );
  }

  await upsertAlerts(sql, alerts);
  const removed = await deleteStaleAlerts(sql, alerts.map((a) => a.alert_id));
  console.log(`Upserted ${alerts.length} alert(s)${removed > 0 ? `, removed ${removed} stale row(s)` : ''}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
