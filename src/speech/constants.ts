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

/**
 * If Google's audio isn't ready this long after an announcement is
 * dispatched, speak it on the on-device voice instead of waiting. A
 * prefetched sentence is ready in well under 200ms; this only bites on a
 * prefetch miss (Google round-trip measured 850-1650ms on drive tests).
 * 2s is the product call (20 Nov 2026): Google's voice for everything but
 * the speed-camera warning wherever it can arrive within 2s, the device
 * voice only as the backstop - so a trip doesn't flip between voices on
 * every ordinary miss. Not a failure: the fetch is enforced natively
 * (api/nativeTimeoutRequest.ts) and GOOGLE_TTS_RETRY_COOLDOWN_MS is not
 * started.
 */
export const GOOGLE_TTS_READY_DEADLINE_MS = 2_000;
