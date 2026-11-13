/**
 * Arrival clock time for the navigation status bar: "ARR 3:45 PM".
 * etaMs is an absolute epoch-ms arrival estimate, so this is just a
 * locale clock format - kept in its own file so the status bar and any
 * future arrival card share one 12-hour AU-style convention.
 */
export function formatArrivalTime(etaMs: number): string {
  return new Date(etaMs)
    .toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s/g, ' ')
    .toUpperCase();
}
