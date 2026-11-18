#!/usr/bin/env node
/**
 * Nightly police mobile-camera notice scrape: runs every registered
 * state scraper (scripts/scrapers/states/) and posts the normalized
 * alerts to POST /api/ingest, on a GitHub Actions schedule
 * (.github/workflows/refresh-police-notices.yml - GHA cron, not Vercel
 * Cron, matching refreshWazeAlerts.js's own reasoning).
 *
 * Each alert conforms to shared/alert-schema.ts (source 'police_notice',
 * type 'mobile_camera') and carries a deterministic id keyed on the notice's
 * identity, so re-scraping the same published notice upserts rather
 * than stacking duplicate alert rows.
 *
 * Usage:
 *   node scripts/scrapePoliceNotices.js                 # scrape all states, POST to /api/ingest
 *   node scripts/scrapePoliceNotices.js --state sa      # one state only
 *   node scripts/scrapePoliceNotices.js --parse-only    # fetch + parse, print raw notices, no geocode/POST
 *   node scripts/scrapePoliceNotices.js --dry-run       # full pipeline incl. geocoding, print alerts, no POST
 *   node scripts/scrapePoliceNotices.js --dry-run --out out.json   # also write alerts to a file
 *   node scripts/scrapePoliceNotices.js --limit 10      # cap geocoded/emitted notices (quick checks)
 *
 * Env (.env / server/.env):
 *   SCRAPERAPI_KEY                  - WAF proxy for the notice pages (see lib/scraperApi.js)
 *   EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN - forward-geocodes notice addresses
 *   BACKEND_API_URL (or EXPO_PUBLIC_BACKEND_API_URL) +
 *   INGEST_SECRET_POLICE_NOTICE - posting only (per-source ingest
 *   credential - see server/api/ingest.ts's SOURCE_INGEST_SECRET_ENV)
 *   SENTRY_DSN (optional)           - failure reporting; the job exits
 *                                     non-zero either way (fail loudly)
 */

const fs = require('fs');
const path = require('path');
const { SCRAPERS } = require('./scrapers/states');
const { postAlerts } = require('./scrapers/lib/ingestClient');
const { reportJobFailure } = require('./scrapers/lib/sentryReporter');

const JOB_NAME = 'scrape-police-notices';

function parseArgs(argv) {
  const args = { state: 'all', dryRun: false, parseOnly: false, limit: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--state') args.state = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--parse-only') args.parseOnly = true;
    else if (arg === '--limit') args.limit = Number(argv[++i]);
    else if (arg === '--out') args.out = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const keys = args.state === 'all' ? Object.keys(SCRAPERS) : [args.state];
  const allAlerts = [];

  for (const key of keys) {
    const Scraper = SCRAPERS[key];
    if (!Scraper) throw new Error(`No scraper registered for state "${key}" (have: ${Object.keys(SCRAPERS).join(', ')})`);
    const scraper = new Scraper();
    console.log(`\n=== ${scraper.displayName} (${scraper.pageUrl}) ===`);

    if (args.parseOnly) {
      const notices = await scraper.fetchNotices();
      console.log(JSON.stringify(notices, null, 2));
      console.log(`${notices.length} notice(s) parsed (pre-expiry filter).`);
      continue;
    }

    const { notices, deduplicatedCount, expiredCount, alerts, failures } = await scraper.scrape({
      limit: args.limit,
      onGeocodeProgress: (notice, i, total) =>
        process.stdout.write(`\r  geocoding ${i + 1}/${total}: ${notice.street}, ${notice.suburb}   `),
    });
    process.stdout.write('\n');
    console.log(
      `  ${notices.length} parsed (${deduplicatedCount} duplicate, ${expiredCount} already expired) -> ${alerts.length} geocoded alert(s), ${failures.length} failed`
    );
    for (const failure of failures) {
      console.log(`    - ${failure.notice.street}, ${failure.notice.suburb} [${failure.notice.area}] - ${failure.reason}`);
    }
    allAlerts.push(...alerts);
  }

  if (args.parseOnly) return;

  if (args.out) {
    const outPath = path.resolve(args.out);
    fs.writeFileSync(outPath, JSON.stringify(allAlerts, null, 2));
    console.log(`Wrote ${allAlerts.length} alert(s) to ${outPath}`);
  }

  if (args.dryRun) {
    console.log('\n--dry-run: not posting to /api/ingest. Sample alerts:');
    console.log(JSON.stringify(allAlerts.slice(0, 5), null, 2));
    return;
  }

  console.log(`\nPosting ${allAlerts.length} alert(s) to /api/ingest...`);
  const result = await postAlerts(allAlerts);
  console.log(`Ingest: ${result.inserted} inserted, ${result.updated} already-known, ${result.failed.length} rejected.`);
  if (result.failed.length > 0) {
    for (const failure of result.failed) {
      console.log(`    - ${failure.alert.id} -> HTTP ${failure.status}: ${failure.body}`);
    }
    // Any rejection means a payload got past the scraper that the schema
    // rejected (or the endpoint is down) - fail loudly, not a partial
    // silent success.
    throw new Error(`${result.failed.length} alert(s) rejected by /api/ingest`);
  }
}

main().catch(async (error) => {
  console.error(error);
  await reportJobFailure(JOB_NAME, error);
  process.exit(1);
});
