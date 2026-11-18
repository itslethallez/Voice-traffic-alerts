const { parseAuDate, localDateWindowToUtc } = require('../zonedTime.js');

describe('parseAuDate', () => {
  it('parses DD/MM/YYYY', () => {
    expect(parseAuDate('17/09/2026')).toEqual({ day: 17, month: 9, year: 2026 });
  });
  it('rejects anything else', () => {
    expect(parseAuDate('2026-09-17')).toBeNull();
    expect(parseAuDate('7/9/26')).toBeNull();
    expect(parseAuDate('')).toBeNull();
  });
});

describe('localDateWindowToUtc', () => {
  // September is ACST (UTC+9:30): a whole Adelaide day is 14:30Z the
  // previous UTC date through 14:29:59.999Z of the notice date.
  it('converts a single Adelaide day to a UTC window', () => {
    const { first_seen, expires_at } = localDateWindowToUtc(
      { day: 18, month: 9, year: 2026 },
      undefined,
      'Australia/Adelaide'
    );
    expect(first_seen).toBe('2026-09-17T14:30:00.000Z');
    expect(expires_at).toBe('2026-09-18T14:29:59.999Z');
  });

  it('spans multi-day country windows end to end', () => {
    const { first_seen, expires_at } = localDateWindowToUtc(
      { day: 14, month: 9, year: 2026 },
      { day: 27, month: 9, year: 2026 },
      'Australia/Adelaide'
    );
    expect(first_seen).toBe('2026-09-13T14:30:00.000Z');
    expect(expires_at).toBe('2026-09-27T14:29:59.999Z');
  });

  it('handles the AEDT transition (first Sunday of October)', () => {
    // 04/10/2026 02:00 ACST -> AEDT: after the switch Adelaide is UTC+10:30,
    // so a day window starting 05/10 begins at 13:30Z, not 14:30Z.
    const { first_seen } = localDateWindowToUtc(
      { day: 5, month: 10, year: 2026 },
      undefined,
      'Australia/Adelaide'
    );
    expect(first_seen).toBe('2026-10-04T13:30:00.000Z');
  });
});
