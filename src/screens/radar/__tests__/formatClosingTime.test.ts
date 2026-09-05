import { formatClosingTime } from '../formatClosingTime';

describe('formatClosingTime', () => {
  it('returns null below the stationary speed threshold', () => {
    expect(formatClosingTime(1000, 4)).toBeNull();
    expect(formatClosingTime(1000, 0)).toBeNull();
  });

  it('formats under 90 seconds as whole seconds', () => {
    // 1200m at 60km/h (16.67 m/s) = 72s
    expect(formatClosingTime(1200, 60)).toBe('72 S');
  });

  it('formats 90 seconds and above as whole minutes', () => {
    // 2000m at 60km/h (16.67 m/s) = 120s = 2min
    expect(formatClosingTime(2000, 60)).toBe('2 MIN');
  });

  it('rounds to the nearest second/minute', () => {
    // 1000m at 60km/h = 60s exactly
    expect(formatClosingTime(1000, 60)).toBe('60 S');
  });
});
