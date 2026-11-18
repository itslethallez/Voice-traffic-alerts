// Fixture mirrors the real page's structure (observed Sep 2026): the
// same records rendered as metro `data-value` dailies and country
// `datestart/dateend` weeklies, each section flagging the other's rows
// `hidelist`.
const { SaMobileCameraScraper } = require('../sa.js');

/** The notice shape parseNotices() emits (declared in
 * lib/policeNoticeScraper.js's contract comment - plain JS module, so
 * the type is restated here for the test). */
interface Notice {
  street: string;
  suburb: string;
  area: string;
  startDate: { day: number; month: number; year: number };
  endDate?: { day: number; month: number; year: number };
}

const FIXTURE = `
  <ul class="metrolist1">
    <li class="showlist" data-value="18/09/2026">ANZAC HWY, ASHFORD</li>
    <li class="showlist" data-value="19/09/2026">BECKMAN ST, PLYMPTON</li>
    <li class="hidelist" data-value="14/09/2026">ALEXANDRINA RD, CURRENCY CREEK</li>
    <li class="showlist" data-value="bogus">BROKEN ROW, NOWHERE</li>
  </ul>
  <ul class="countrylist">
    <li class="showlist" datestart="14/09/2026" dateend="27/09/2026">ALEXANDRINA RD, CURRENCY CREEK</li>
    <li class="hidelist" datestart="18/09/2026" dateend="18/09/2026">ANZAC HWY, ASHFORD</li>
  </ul>
`;

describe('SaMobileCameraScraper.parseNotices', () => {
  const notices: Notice[] = new SaMobileCameraScraper().parseNotices(FIXTURE);

  it('parses metro daily and country weekly showlist rows', () => {
    expect(notices).toHaveLength(3);
    const metro = notices.find((n) => n.street === 'ANZAC HWY');
    expect(metro).toMatchObject({
      suburb: 'ASHFORD',
      area: 'metro',
      startDate: { day: 18, month: 9, year: 2026 },
    });
    const country = notices.find((n) => n.area === 'country');
    expect(country).toMatchObject({
      street: 'ALEXANDRINA RD',
      suburb: 'CURRENCY CREEK',
      startDate: { day: 14, month: 9, year: 2026 },
      endDate: { day: 27, month: 9, year: 2026 },
    });
  });

  it('ignores hidelist rows and malformed dates', () => {
    // hidelist rows would double-count the two sections; the bogus
    // data-value row is unparseable and must be skipped, not emitted.
    expect(notices.filter((n) => n.street === 'ALEXANDRINA RD')).toHaveLength(1);
    expect(notices.some((n) => n.street === 'BROKEN ROW')).toBe(false);
  });

  it('throws when the page structure changed', () => {
    expect(() => new SaMobileCameraScraper().parseNotices('<html><body>restructured</body></html>')).toThrow(
      /metrolist1/
    );
  });
});
