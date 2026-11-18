const { SaMobileCameraScraper } = require('./sa');

/**
 * Registry of police-notice scrapers keyed by state. Adding a state =
 * one new file beside sa.js implementing PoliceNoticeScraper, plus one
 * line here - scripts/scrapePoliceNotices.js iterates this map.
 */
const SCRAPERS = {
  sa: SaMobileCameraScraper,
};

module.exports = { SCRAPERS };
