const { PoliceNoticeScraper, stripTags } = require('../lib/policeNoticeScraper');
const { parseAuDate } = require('../lib/zonedTime');

const PAGE_URL =
  'https://www.police.sa.gov.au/your-safety/road-safety/traffic-camera-locations/mobile-camera-container';

/**
 * SA Police mobile-camera notices. The page renders one 225-item master
 * list twice: as metro "daily" tabs (`ul.metrolist1`-`metrolist7`, all
 * identical copies - jQuery filters each to one date for the tab UI, so
 * parsing just `metrolist1` gets the full set) and as a country
 * "this week" list (`ul.countrylist` with datestart/dateend ranges).
 * Each `<li>` is `STREET, SUBURB` plus:
 *   - metro:    class="showlist" + data-value="DD/MM/YYYY"  (single day)
 *   - country:  class="showlist" + datestart/dateend        (day range)
 * The section's own `hidelist` entries are the other section's records
 * (and stale/past days) - the class flag is SAPOL's own "this is a live
 * notice" marker, so only `showlist` items are parsed; whole-day
 * windows already past are additionally filtered downstream in
 * scrape(), since a metro item keeps its showlist class for the whole
 * published week even after its day passes.
 */
class SaMobileCameraScraper extends PoliceNoticeScraper {
  get key() {
    return 'sa';
  }

  get displayName() {
    return 'SA Police mobile cameras';
  }

  get pageUrl() {
    return PAGE_URL;
  }

  get timezone() {
    return 'Australia/Adelaide';
  }

  get geocodeRegion() {
    return 'South Australia, Australia';
  }

  parseNotices(html) {
    const notices = [
      ...this.parseMetroList(html),
      ...this.parseCountryList(html),
    ];
    return notices;
  }

  /** Daily metro notices: `ul.metrolist1` `li.showlist` rows carry the
   * single-day date in data-value. */
  parseMetroList(html) {
    const block = extractListBlock(html, 'metrolist1');
    if (!block) {
      throw new Error('Could not find ul.metrolist1 on the SAPOL mobile-camera page - it may have been restructured.');
    }
    return parseListItems(block, (attrs, text) => {
      const date = parseAuDate(attrs['data-value'] ?? '');
      if (!date) return null;
      return { ...splitStreetSuburb(text), area: 'metro', startDate: date };
    });
  }

  /** Weekly country notices: `ul.countrylist` `li.showlist` rows carry
   * the covered range in datestart/dateend. */
  parseCountryList(html) {
    const block = extractListBlock(html, 'countrylist');
    if (!block) {
      throw new Error('Could not find ul.countrylist on the SAPOL mobile-camera page - it may have been restructured.');
    }
    return parseListItems(block, (attrs, text) => {
      const start = parseAuDate(attrs.datestart ?? '');
      const end = parseAuDate(attrs.dateend ?? '');
      if (!start || !end) return null;
      return { ...splitStreetSuburb(text), area: 'country', startDate: start, endDate: end };
    });
  }
}

/** Pulls the inner HTML of `<ul class="NAME">...</ul>`. */
function extractListBlock(html, className) {
  const match = html.match(new RegExp(`<ul class="${className}"[^>]*>([\\s\\S]*?)</ul>`));
  return match ? match[1] : null;
}

/**
 * Maps `li.showlist` rows through `toNotice(attrs, text)`; rows that
 * produce null are counted as skipped (they're malformed, not absent -
 * worth logging so a format drift shows up in the job output).
 */
function parseListItems(blockHtml, toNotice) {
  const notices = [];
  let skipped = 0;
  for (const match of blockHtml.matchAll(/<li class="([^"]*)"([^>]*)>([\s\S]*?)<\/li>/g)) {
    if (!match[1].split(/\s+/).includes('showlist')) continue;
    const attrText = match[2];
    const attrs = {};
    for (const attr of attrText.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[attr[1]] = attr[2];
    const notice = toNotice(attrs, stripTags(match[3]));
    if (notice && notice.street && notice.suburb) notices.push(notice);
    else skipped += 1;
  }
  if (skipped > 0) console.warn(`  [sa] skipped ${skipped} malformed showlist row(s)`);
  return notices;
}

/** "ANZAC HWY, ASHFORD" -> { street, suburb }; splits on the LAST comma
 * so street names containing commas survive. */
function splitStreetSuburb(text) {
  const idx = text.lastIndexOf(',');
  if (idx === -1) return { street: text.trim(), suburb: '' };
  return { street: text.slice(0, idx).trim(), suburb: text.slice(idx + 1).trim() };
}

module.exports = { SaMobileCameraScraper };
