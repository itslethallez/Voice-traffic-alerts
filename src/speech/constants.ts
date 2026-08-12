/** "Minimum 20 seconds between announcements so it does not become a nag." */
export const MIN_ANNOUNCEMENT_GAP_MS = 20_000;

/** "If the report is over 10 minutes old, append 'reported {n} minutes ago'." Exclusive - exactly 10 minutes doesn't get the addendum. */
export const STALE_ANNOUNCEMENT_AGE_MINUTES = 10;
