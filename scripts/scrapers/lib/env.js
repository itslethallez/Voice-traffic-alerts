const fs = require('fs');
const path = require('path');

/**
 * Reads one KEY=value line from .env without a dotenv dependency (same
 * approach as the existing scripts/*.js ingest jobs). Searches the
 * repo-root .env first, then server/.env - the root file holds shared
 * keys (SCRAPERAPI_KEY, EXPO_PUBLIC_*) while server/.env holds the
 * ingest/DB secrets, and a scheduled job may legitimately need both.
 * CI writes everything into the root .env anyway, so the root file
 * always wins when a key exists in both places.
 */
function readEnvValue(key, { required = true } = {}) {
  for (const rel of ['.env', path.join('server', '.env')]) {
    const envPath = path.join(__dirname, '..', '..', '..', rel);
    if (!fs.existsSync(envPath)) continue;
    const match = fs.readFileSync(envPath, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    if (match && match[1].trim()) return match[1].trim();
  }
  if (required) throw new Error(`${key} is not set in .env or server/.env`);
  return undefined;
}

module.exports = { readEnvValue };
