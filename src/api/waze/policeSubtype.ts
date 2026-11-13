/**
 * Waze's `subtype` field, present on a POLICE alert when the reporting
 * driver picked a more specific category (e.g. "POLICE_VISIBLE" for a
 * visible patrol car) - confirmed present in OpenWeb Ninja's live
 * response/dashboard data, not just inferred from the Waze app's own UI.
 * Humanized generically (strip the POLICE_ prefix, title-case each word,
 * "Police" first - e.g. "POLICE_VISIBLE" -> "Police Visible") rather than
 * mapped through a hardcoded enum: "POLICE_VISIBLE" is the only exact
 * subtype string independently confirmed so far, and guessing the rest of
 * Waze's enum wrong would silently mislabel a real subtype instead of
 * falling back cleanly.
 *
 * Returns null - callers fall back to the generic "Police" label - for a
 * null/missing subtype, the shared "NO_SUBTYPE" sentinel Waze uses across
 * every alert type, or any subtype string that isn't actually
 * POLICE_-prefixed (defensive only; every real POLICE subtype is).
 */
const POLICE_SUBTYPE_PREFIX = 'POLICE_';

export function policeSubtypeLabel(subtype: string | null | undefined): string | null {
  if (!subtype || subtype === 'NO_SUBTYPE' || !subtype.startsWith(POLICE_SUBTYPE_PREFIX)) {
    return null;
  }

  const words = subtype
    .slice(POLICE_SUBTYPE_PREFIX.length)
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

  return words.length > 0 ? `Police ${words.join(' ')}` : null;
}
