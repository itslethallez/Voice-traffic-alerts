const { readEnvValue } = require('./env');

const SCRAPERAPI_ENDPOINT = 'http://api.scraperapi.com';
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Fetches a URL through ScraperAPI (https://www.scraperapi.com, free
 * tier: 1,000 requests/month - the scrapers run nightly, so usage is
 * negligible). Required because police/government sites commonly block
 * datacenter IP ranges at their WAF: Node's fetch gets a 403 from
 * police.sa.gov.au even with a browser User-Agent, from both a dev
 * machine and GitHub Actions runners. See buildFixedCameraDataset.js's
 * fetchSapolPageHtml for the original write-up of the problem.
 *
 * `preferredPremium` selects which ScraperAPI pool to try first
 * (premium = residential/higher-trust IPs, ~60-90s per request;
 * standard = their normal pool, a few seconds). Whichever pool is
 * preferred, a failed first attempt is retried once through the other
 * pool: observed behaviour differs per target URL and per day (the
 * SAPOL mobile page has returned 500 on premium while succeeding on
 * standard, and the fixed-camera page historically needed premium
 * because standard got WAF-blocked), so hard-coding either mode is
 * brittle. A request ScraperAPI refuses is not billed.
 */
async function fetchViaScraperApi(targetUrl, { preferredPremium = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const apiKey = readEnvValue('SCRAPERAPI_KEY');
  const modes = preferredPremium ? [true, false] : [false, true];

  let lastError;
  for (const premium of modes) {
    const url = new URL(SCRAPERAPI_ENDPOINT);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('url', targetUrl);
    if (premium) url.searchParams.set('premium', 'true');
    try {
      const response = await fetch(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
      const body = await response.text();
      if (response.ok) {
        if (premium !== preferredPremium) {
          console.warn(`  [scraperapi] ${premium ? 'premium' : 'standard'} pool succeeded after preferred pool failed`);
        }
        return body;
      }
      lastError = new Error(`ScraperAPI request failed (${response.status}, premium=${premium}): ${body.slice(0, 300)}`);
    } catch (error) {
      lastError = error;
    }
    console.warn(`  [scraperapi] premium=${premium} attempt failed - ${lastError.message.split('\n')[0]}`);
  }
  throw lastError;
}

module.exports = { fetchViaScraperApi };
