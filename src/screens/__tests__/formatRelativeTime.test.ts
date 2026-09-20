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

  it('shows minutes from 60 seconds up to an hour', () => {
    expect(formatRelativeTime(0, 60_000)).toBe('1m ago');
    expect(formatRelativeTime(0, 5 * 60_000)).toBe('5m ago');
    expect(formatRelativeTime(0, 59 * 60_000)).toBe('59m ago');
  });

  it('shows hours from an hour up to a day', () => {
    expect(formatRelativeTime(0, 60 * 60_000)).toBe('1h ago');
    expect(formatRelativeTime(0, 23 * 60 * 60_000)).toBe('23h ago');
  });

  it('shows days at a day and above - long-lived alerts must not print raw minutes', () => {
    expect(formatRelativeTime(0, 24 * 60 * 60_000)).toBe('1d ago');
    expect(formatRelativeTime(0, 185 * 24 * 60 * 60_000)).toBe('185d ago');
  });

  it('never goes negative for a clock that has not advanced', () => {
    expect(formatRelativeTime(5000, 1000)).toBe('just now');
  });
});
