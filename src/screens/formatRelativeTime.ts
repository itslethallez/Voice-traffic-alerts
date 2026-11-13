/** "just now" / "Xs ago" / "Xm ago" / "Xh ago" / "Xd ago" - short enough
 * to read at a glance. Long-lived rows (a fixed_db or police_notice alert
 * first_seen months ago) need the h/d branches — without them a stale
 * timestamp prints as a raw six-digit minute count. */
export function formatRelativeTime(atMs: number, nowMs: number): string {
  const elapsedSeconds = Math.max(0, Math.round((nowMs - atMs) / 1000));

  if (elapsedSeconds < 10) return 'just now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;

  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  return `${Math.round(elapsedHours / 24)}d ago`;
}
