const { readEnvValue } = require('./env');

const SCRAPERAPI_ENDPOINT = 'http://api.scraperapi.com';
const DEFAULT_TIMEOUT_MS = 120_000;
/**
 * The SAPOL pages pass Cloudflare only intermittently, from either pool
 * (Nov 2026: standard 1 in 6 with AU exits; premium rescued the 18 Nov
 * police run after standard failed). Refused requests aren't billed, so
 * retrying is free; at ~60 s per failed attempt, 3 rounds of
 * standard + premium stay well inside the workflow runtime.
 */
const DEFAULT_ROUNDS = 3;

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
 * brittle. A request ScraperAPI refuses is not billed, so each of
 * `rounds` rounds tries both pools (preferred first). Premium is
 * available on the free plan (a successful premium call costs 10 credits;
 * ultra_premium is not available).
 *
 * `countryCode` (default 'au') routes through IPs in that country. Every
 * target is an Australian government site, and police.sa.gov.au's
 * Cloudflare challenge rejects non-AU exits (Nov 2026: standard and
 * premium both 500 without it, standard 200 with it). Geotargeting
 * is available on the free plan.
 */
async function fetchViaScraperApi(
  targetUrl,
  {
    preferredPremium = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    countryCode = 'au',
    rounds = DEFAULT_ROUNDS,
  } = {}
) {
  const apiKey = readEnvValue('SCRAPERAPI_KEY');
  const modes = Array.from({ length: Math.max(1, rounds) }, () => [preferredPremium, !preferredPremium]).flat();

  let lastError;
  for (const [index, premium] of modes.entries()) {
    const url = new URL(SCRAPERAPI_ENDPOINT);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('url', targetUrl);
    if (countryCode) url.searchParams.set('country_code', countryCode);
    if (premium) url.searchParams.set('premium', 'true');
    try {
      const response = await fetch(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
      const body = await response.text();
      if (response.ok) {
        if (index > 0) {
          console.warn(`  [scraperapi] ${premium ? 'premium' : 'standard'} pool succeeded on attempt ${index + 1}/${modes.length}`);
        }
        return body;
      }
      lastError = new Error(`ScraperAPI request failed (${response.status}, premium=${premium}): ${body.slice(0, 300)}`);
      // 401 = bad key: retrying can't help and every retry just delays the failure alert.
      if (response.status === 401) break;
    } catch (error) {
      lastError = error;
    }
    console.warn(
      `  [scraperapi] attempt ${index + 1}/${modes.length} premium=${premium} failed - ${lastError.message.split('\n')[0]}`
    );
  }
  throw lastError;
}

module.exports = { fetchViaScraperApi };
