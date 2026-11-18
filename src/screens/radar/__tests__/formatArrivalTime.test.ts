import { formatArrivalTime } from '../formatArrivalTime';

describe('formatArrivalTime', () => {
  it('formats an epoch-ms ETA as a 12-hour clock time', () => {
    // 2026-09-20T15:45:00 local - only the wall-clock rendering matters.
    const eta = new Date(2026, 8, 20, 15, 45).getTime();
    const out = formatArrivalTime(eta);
    expect(out).toMatch(/3:45\s?PM/);
  });

  it('renders hour-less-than-10 without a leading zero', () => {
    const eta = new Date(2026, 8, 20, 9, 5).getTime();
    const out = formatArrivalTime(eta);
    expect(out).toMatch(/^9:05\s?AM$/);
  });
});
