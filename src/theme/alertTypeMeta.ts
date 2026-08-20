import type { WazeAlertType } from '../api/waze/types';
import { colors } from './colors';

export interface AlertTypeMeta {
  /** Short label for radar-UI markers - a presentation concern, kept
   * separate from speech/formatAnnouncement.ts's own wording so Step 11
   * doesn't touch the existing announcement/briefing text. */
  label: string;
  color: string;
  /** Marker glyph (Step 11b) - matches the mockup's emoji-per-type pins. */
  emoji: string;
}

const ALERT_TYPE_META: Partial<Record<string, AlertTypeMeta>> = {
  POLICE: { label: 'Police', color: colors.accent, emoji: '🚓' },
  ACCIDENT: { label: 'Crash', color: '#E85D5D', emoji: '💥' },
  HAZARD: { label: 'Hazard', color: colors.warning, emoji: '⚠️' },
  ROAD_CLOSED: { label: 'Closed', color: '#E85D5D', emoji: '🚧' },
  JAM: { label: 'Jam', color: colors.warning, emoji: '🚗' },
};

const DEFAULT_ALERT_TYPE_META: AlertTypeMeta = { label: 'Alert', color: colors.inkFaint, emoji: '❗' };

export function alertTypeMeta(type: WazeAlertType): AlertTypeMeta {
  return ALERT_TYPE_META[type] ?? DEFAULT_ALERT_TYPE_META;
}
