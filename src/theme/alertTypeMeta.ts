import type { WazeAlertType } from '../api/waze/types';
import { colors } from './colors';

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

const ALERT_TYPE_META: Partial<Record<string, AlertTypeMeta>> = {
  POLICE: { label: 'Police', color: colors.accent, emoji: '🚓', letter: 'P' },
  ACCIDENT: { label: 'Crash', color: '#E85D5D', emoji: '💥', letter: 'X' },
  HAZARD: { label: 'Hazard', color: colors.warning, emoji: '⚠️', letter: 'H' },
  ROAD_CLOSED: { label: 'Closed', color: '#E85D5D', emoji: '🚧', letter: 'C' },
  JAM: { label: 'Jam', color: colors.warning, emoji: '🚗', letter: 'J' },
};

const DEFAULT_ALERT_TYPE_META: AlertTypeMeta = {
  label: 'Alert',
  color: colors.inkFaint,
  emoji: '❗',
  letter: '!',
};

export function alertTypeMeta(type: WazeAlertType): AlertTypeMeta {
  return ALERT_TYPE_META[type] ?? DEFAULT_ALERT_TYPE_META;
}
