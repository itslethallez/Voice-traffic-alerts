/** "Minimum 20 seconds between announcements so it does not become a nag." */
export const MIN_ANNOUNCEMENT_GAP_MS = 20_000;

/** "If the report is over 10 minutes old, append 'reported {n} minutes ago'." Exclusive - exactly 10 minutes doesn't get the addendum. */
export const STALE_ANNOUNCEMENT_AGE_MINUTES = 10;

/**
 * The cold-start briefing is a deliberate back-to-back list read, not a
 * live-driving interrupt - a short pause between items, not the 20s
 * MIN_ANNOUNCEMENT_GAP_MS live driving uses.
 */
export const BRIEFING_GAP_MS = 1500;

/**
 * Once Google TTS fails for one announcement, ttsAdapter.ts sticks with the
 * on-device fallback voice for this long before trying Google again, rather
 * than retrying fresh on every single alert. A real Google TTS outage or a
 * patchy-signal stretch of road lasts a lot longer than the ~20s between
 * announcements - retrying every time just means audibly flip-flopping
 * between two very different-sounding voices (natural Google voice, robotic
 * on-device voice) for as long as the bad conditions last.
 */
export const GOOGLE_TTS_RETRY_COOLDOWN_MS = 2 * 60 * 1000;
