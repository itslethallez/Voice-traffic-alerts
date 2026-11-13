const crypto = require('crypto');
const { readEnvValue } = require('./env');

/**
 * Minimal Sentry error report for scheduled scraper jobs - the
 * .windsurfrules non-negotiable is "nightly scraper jobs must fail
 * loudly (Sentry alert), never silently". Hand-rolled envelope POST
 * rather than the @sentry/node SDK because these scripts deliberately
 * run on the repo-root dependency set (plain `node`, no TS build, no
 * server/node_modules - same constraint as the existing scripts/*.js
 * ingest jobs).
 *
 * Best-effort: a broken DSN or a Sentry outage must never mask the real
 * failure - the job still exits non-zero and the GitHub Actions run
 * still goes red.
 */
async function reportJobFailure(jobName, error) {
  const dsn = readEnvValue('SENTRY_DSN', { required: false });
  if (!dsn) return;
  const match = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
  if (!match) {
    console.warn('[sentry] SENTRY_DSN did not parse - skipping error report');
    return;
  }
  const [, publicKey, host, projectId] = match;

  const eventId = crypto.randomBytes(16).toString('hex');
  const envelope = [
    JSON.stringify({ event_id: eventId }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify({
      event_id: eventId,
      platform: 'node',
      level: 'error',
      logger: 'scraper',
      transaction: jobName,
      timestamp: Date.now() / 1000,
      message: `${jobName} failed: ${error?.message ?? String(error)}`,
      exception: {
        values: [
          {
            type: error?.name ?? 'Error',
            value: error?.message ?? String(error),
            stacktrace: error?.stack ? { frames: [{ filename: 'main', function: error.stack.slice(0, 500) }] } : undefined,
          },
        ],
      },
      tags: { job: jobName },
    }),
  ].join('\n');

  try {
    await fetch(`https://${host}/api/${projectId}/envelope/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${publicKey}`,
      },
      body: envelope,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (reportError) {
    console.warn('[sentry] failed to report job failure:', reportError.message);
  }
}

module.exports = { reportJobFailure };
