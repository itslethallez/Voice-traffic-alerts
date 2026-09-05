/** "just now" / "Xs ago" / "Xm ago" - short enough to read at a glance. */
export function formatRelativeTime(atMs: number, nowMs: number): string {
  const elapsedSeconds = Math.max(0, Math.round((nowMs - atMs) / 1000));

  if (elapsedSeconds < 10) return 'just now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;

  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  return `${elapsedMinutes}m ago`;
}
