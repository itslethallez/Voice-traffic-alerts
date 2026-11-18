const { readEnvValue } = require('./env');
const { fetchViaScraperApi } = require('./scraperApi');
const { geocodeNoticeAddress } = require('./geocode');
const { localDateWindowToUtc } = require('./zonedTime');
const { deterministicAlertId } = require('./alertIds');

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
 * Collapses failure reasons into "reason (xN)" counts for the
 * all-failed error. The per-notice query string is stripped so an
 * identical failure mode repeated for every notice (e.g. a rejected
 * token 401ing all 171 calls) groups into one line instead of 171
 * near-duplicates. Capped - suburb-mismatch reasons stay distinct.
 */
function summarizeFailureReasons(failures) {
  const counts = new Map();
  for (const { reason } of failures) {
    const key = reason.replace(/ for ".*"$/, '');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const entries = [...counts.entries()];
  const shown = entries
    .slice(0, 3)
    .map(([reason, n]) => `${reason}${n > 1 ? ` (x${n})` : ''}`)
    .join('; ');
  return entries.length > 3 ? `${shown}; +${entries.length - 3} more` : shown;
}

/**
 * Base class for state police mobile-camera notice scrapers. Each state
 * implements the small surface below; everything else - fetching through
 * the WAF proxy, forward-geocoding notice addresses, converting local
 * notice dates into UTC alert windows, deterministic alert ids for
 * idempotent ingest - lives here so a new state is a new file under
 * states/, not a rewrite.
 *
 * A "notice" is one published camera placement before normalization:
 *   { street, suburb, area, startDate, endDate? }
 * where startDate/endDate are { year, month, day } local calendar dates
 * in the state's `timezone` (notices publish dates, never instants) and
 * `area` is a free-text grouping from the source page (e.g. 'metro' /
 * 'country') kept only for logging and the deterministic id.
 *
 * Subclass contract:
 *   key            - short registry key ('sa')
 *   displayName    - human-readable source name for logs
 *   pageUrl        - notice page to fetch
 *   timezone       - IANA zone the notice dates are in
 *   geocodeRegion  - suffix appended to geocode queries ('South Australia, Australia')
 *   premiumProxy   - whether to prefer ScraperAPI's premium pool first (default false)
 *   parseNotices(html) -> Notice[]
 * Optional overrides:
 *   fetchSource()          - replace the ScraperAPI GET entirely (e.g. a state
 *                            whose page needs no proxy, or a JSON endpoint)
 *   geocodeQuery(notice)   - customise the address string sent to Mapbox
 *   expectedSuburb(notice) - customise the suburb the geocode is validated against
 */
class PoliceNoticeScraper {
  get premiumProxy() {
    return false;
  }

  async fetchSource() {
    const html = await fetchViaScraperApi(this.pageUrl, { preferredPremium: this.premiumProxy });
    if (!html || html.length < 1000) {
      throw new Error(`${this.displayName} page fetch returned unexpectedly little content - check the URL/network manually.`);
    }
    return html;
  }

  geocodeQuery(notice) {
    return `${notice.street}, ${notice.suburb}, ${this.geocodeRegion}`;
  }

  expectedSuburb(notice) {
    return notice.suburb;
  }

  /** Fetch + parse only - no geocoding, no alert assembly. */
  async fetchNotices() {
    const html = await this.fetchSource();
    const notices = this.parseNotices(html);
    if (notices.length === 0) {
      // Zero notices is almost always a restructured page, not a state
      // with no cameras - fail loudly rather than ingest nothing.
      throw new Error(`${this.displayName} parse produced 0 notices - the page structure may have changed.`);
    }
    return notices;
  }

  /**
   * Full pipeline: fetch -> parse -> drop already-expired windows ->
   * geocode -> normalized alerts (shared/alert-schema.ts shape with a
   * deterministic id so re-scrapes upsert). Per-notice geocode failures
   * are collected in `failures` and skipped, matching
   * buildFixedCameraDataset.js's tolerance; a total wipeout still
   * throws via fetchNotices's zero-parse guard.
   */
  async scrape({ limit, onGeocodeProgress } = {}) {
    const notices = await this.fetchNotices();

    // Same street/suburb/window listed twice on the page (seen on the
    // SAPOL country list) would geocode twice and POST the same
    // deterministic id twice - dedupe on identity before spending calls.
    const seenKeys = new Set();
    const unique = notices.filter((notice) => {
      const key = `${notice.street}|${notice.suburb}|${JSON.stringify(notice.startDate)}|${JSON.stringify(notice.endDate ?? null)}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    const now = Date.now();
    const live = unique.filter((notice) => {
      const { expires_at } = localDateWindowToUtc(notice.startDate, notice.endDate, this.timezone);
      return new Date(expires_at).getTime() > now;
    });
    const expiredCount = unique.length - live.length;

    const accessToken = readEnvValue('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN');
    const toProcess = limit ? live.slice(0, limit) : live;
    const alerts = [];
    const failures = [];
    for (let i = 0; i < toProcess.length; i++) {
      const notice = toProcess[i];
      onGeocodeProgress?.(notice, i, toProcess.length);
      try {
        const outcome = await geocodeNoticeAddress(
          this.geocodeQuery(notice),
          this.expectedSuburb(notice),
          accessToken,
          { region: this.geocodeRegion }
        );
        if (outcome.failure) {
          failures.push({ notice, reason: outcome.failure });
          continue;
        }
        alerts.push(this.buildAlert(notice, outcome.position));
      } catch (error) {
        failures.push({ notice, reason: error.message });
        // Auth/rate-limit rejections won't recover mid-run - every
        // remaining call fails identically, so abort rather than burn
        // the rest of the batch printing the same status code.
        if (/\((401|403|429)\)/.test(error.message)) {
          throw new Error(`${this.displayName}: geocoding aborted - ${error.message}`);
        }
      }
      // Stay well under Mapbox's rate limits - nightly batch, not a hot path.
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (toProcess.length > 0 && alerts.length === 0) {
      // Every live notice failed to geocode - a Mapbox outage, a bad
      // token, or a systematic address-format change, not a quiet
      // night. Posting an empty batch would look like success while
      // delivering nothing. The causes are inlined because the runner
      // only prints this message on total failure - without them the
      // status code that identifies the root cause never reaches the log.
      throw new Error(
        `${this.displayName}: all ${toProcess.length} live notice(s) failed to geocode. ` +
          `Causes: ${summarizeFailureReasons(failures)}`
      );
    }
    return { notices, deduplicatedCount: notices.length - unique.length, expiredCount, alerts, failures };
  }

  buildAlert(notice, position) {
    const { first_seen, expires_at } = localDateWindowToUtc(notice.startDate, notice.endDate, this.timezone);
    const identity = `${this.key}|${notice.street}|${notice.suburb}|${first_seen}|${expires_at}`;
    return {
      id: deterministicAlertId('police_notice', identity),
      // 'mobile_camera', not 'police': a notice is a published camera
      // window, not a live sighting - the schema split the two so
      // map/voice can treat scheduled enforcement differently from a
      // driver-reported patrol car.
      type: 'mobile_camera',
      lat: position.latitude,
      lng: position.longitude,
      // A notice names a whole street stretch within a suburb, and the
      // geocode lands at one point on it - the radius covers the street,
      // not a surveyed camera position.
      radius_m: this.alertRadiusM,
      // Official scheduled-enforcement notice - high, but not 100: the
      // page itself warns locations may change without notice.
      confidence: this.alertConfidence,
      source: 'police_notice',
      first_seen,
      expires_at,
      corroboration_count: 0,
    };
  }

  get alertRadiusM() {
    return 500;
  }

  get alertConfidence() {
    return 90;
  }
}

module.exports = { PoliceNoticeScraper, stripTags, decodeHtmlEntities };
