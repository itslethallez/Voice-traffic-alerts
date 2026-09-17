import { policeSubtypeLabel } from '../api/waze/policeSubtype';
import type { WazeAlertType } from '../api/waze/types';
import { colors } from './tokens';

export interface AlertTypeMeta {
  /** Short label for radar-UI markers - a presentation concern, kept
   * separate from speech/formatAnnouncement.ts's own wording so Step 11
   * doesn't touch the existing announcement/briefing text. */
  label: string;
  color: string;
  /** Marker glyph (Step 11b) - matches the mockup's emoji-per-type pins.
   * Unused by the Instrument redesign (see `letter`), kept for any screen
   * still on the old palette until migration is complete. */
  emoji: string;
  /** Single-letter marker glyph for the Instrument redesign
   * (design_handoff_instrument_face) - P/H/X/C/J, measured from the
   * design artboard. */
  letter: string;
}

/** Marker colours follow AlertPill's PILL_META severity tiers (police
 * informational blue, traffic/accident critical red, closure/hazard caution
 * amber, roadkill brand teal) so a pin's colour matches its filter pill. */
const ALERT_TYPE_META: Partial<Record<string, AlertTypeMeta>> = {
  POLICE: { label: 'Police', color: colors.coolBlue, emoji: '🚓', letter: 'P' },
  ACCIDENT: { label: 'Crash', color: colors.critical, emoji: '💥', letter: 'X' },
  HAZARD: { label: 'Hazard', color: colors.caution, emoji: '⚠️', letter: 'H' },
  ROAD_CLOSED: { label: 'Closed', color: colors.caution, emoji: '🚧', letter: 'C' },
  JAM: { label: 'Jam', color: colors.critical, emoji: '🚗', letter: 'J' },
  // Normalized-schema type arriving via the corridor feed (mapped in
  // api/backend/corridorAlert.ts) - no Waze equivalent.
  ROADKILL: { label: 'Roadkill', color: colors.accent, emoji: '🦘', letter: 'R' },
};

const DEFAULT_ALERT_TYPE_META: AlertTypeMeta = {
  label: 'Alert',
  color: colors.textMuted,
  emoji: '❗',
  letter: '!',
};

/**
 * `subtype` is optional and only ever consulted for POLICE - passing it
 * for any other type is harmless (policeSubtypeLabel is never called), and
 * omitting it entirely just means the generic per-type label is used, same
 * as before this field existed.
 */
export function alertTypeMeta(type: WazeAlertType, subtype?: string | null): AlertTypeMeta {
  const base = ALERT_TYPE_META[type] ?? DEFAULT_ALERT_TYPE_META;
  if (type === 'POLICE') {
    const subtypeLabel = policeSubtypeLabel(subtype);
    if (subtypeLabel) return { ...base, label: subtypeLabel };
  }
  return base;
}
