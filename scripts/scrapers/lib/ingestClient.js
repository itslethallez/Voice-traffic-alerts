/**
 * Thin client for POST /api/ingest - the single write path into the
 * alerts table. Every payload must already conform to
 * shared/alert-schema.ts (the endpoint re-validates and 400s on
 * anything that doesn't). Auth is a PER-SOURCE shared secret in the
 * x-ingest-secret header: the endpoint resolves the secret to one
 * source and 403s on a payload claiming any other, so each caller's
 * env var is named for its source (INGEST_SECRET_<SOURCE>, e.g.
 * INGEST_SECRET_POLICE_NOTICE).
 */

const { readEnvValue } = require('./env');

function ingestUrl(baseUrl) {
  // BACKEND_API_URL is documented (root .env.example) as ending in /api/
  // - normalize the trailing slash so either form works.
  return `${baseUrl.replace(/\/+$/, '')}/ingest`;
}

/**
 * Posts alerts one at a time (sequential - a few hundred requests over
 * a nightly job is gentler on the function than a burst, and per-alert
 * failures stay attributable). Returns { inserted, updated, failed } -
 * "updated" counts alerts whose deterministic id was already in the
 * table (re-scraped notices upsert rather than duplicate).
 * Throws if the whole endpoint is unreachable/auth fails on the first
 * alert - a run that delivered nothing should fail loudly, not log
 * 200 individual failures.
 */
async function postAlerts(alerts, { onProgress } = {}) {
  if (alerts.length === 0) return { inserted: 0, updated: 0, failed: [] };

  const baseUrl = readEnvValue('BACKEND_API_URL', { required: false }) ?? readEnvValue('EXPO_PUBLIC_BACKEND_API_URL');
  const url = ingestUrl(baseUrl);

  // The request target is worth one log line: a mis-set BACKEND_API_URL
  // (missing the /api suffix, or pointing at a domain with no
  // deployment) surfaces as Vercel's platform 404 on every POST -
  // identical-looking per-alert failures that never reach the function.
  console.log(`ingest endpoint: ${url}`);
  if (!/\/api\/ingest$/.test(url)) {
    console.warn('WARNING: URL does not end in /api/ingest - BACKEND_API_URL must include the /api path or every POST hits Vercel\'s platform 404.');
  }

  // Alerts from one run share a source; the env var name is derived
  // from it so this client never needs a source argument. A mixed batch
  // is a bug worth refusing, not something to fan out across secrets.
  const sources = new Set(alerts.map((a) => a.source));
  if (sources.size !== 1) {
    throw new Error(`postAlerts got a mixed-source batch (${[...sources].join(', ')}) - post each source separately.`);
  }
  const source = alerts[0].source;
  const secret = readEnvValue(`INGEST_SECRET_${source.toUpperCase()}`);

  const result = { inserted: 0, updated: 0, failed: [] };
  for (const alert of alerts) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-secret': secret },
      body: JSON.stringify(alert),
    });
    if (response.status === 201) result.inserted += 1;
    else if (response.status === 200) result.updated += 1;
    else {
      const body = await response.text();
      result.failed.push({ alert, status: response.status, body: body.slice(0, 300) });
    }
    onProgress?.(alert, response.status);
  }
  return result;
}

module.exports = { postAlerts };
