import { formatRelativeTime } from '../formatRelativeTime';

describe('formatRelativeTime', () => {
  it('is "just now" for anything under 10 seconds old', () => {
    expect(formatRelativeTime(1000, 1000)).toBe('just now');
    expect(formatRelativeTime(1000, 1000 + 9000)).toBe('just now');
  });

  it('shows seconds between 10 and 59 seconds old', () => {
    expect(formatRelativeTime(0, 10_000)).toBe('10s ago');
    expect(formatRelativeTime(0, 59_000)).toBe('59s ago');
  });

  it('shows minutes at 60 seconds and above', () => {
    expect(formatRelativeTime(0, 60_000)).toBe('1m ago');
    expect(formatRelativeTime(0, 5 * 60_000)).toBe('5m ago');
  });

  it('never goes negative for a clock that has not advanced', () => {
    expect(formatRelativeTime(5000, 1000)).toBe('just now');
  });
});
