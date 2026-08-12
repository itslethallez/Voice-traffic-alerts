import type { WazeAlertType } from '../api/waze/types';
import { ANNOUNCE_MAX_DISTANCE_M } from '../geo/announceWindow';

export type AlertCategory = 'POLICE' | 'ACCIDENT' | 'HAZARD' | 'ROAD_CLOSED' | 'JAM';

export const ALERT_CATEGORIES: AlertCategory[] = [
  'POLICE',
  'ACCIDENT',
  'HAZARD',
  'ROAD_CLOSED',
  'JAM',
];

/** "Announcement distance slider, 500m to 3km." Only the upper bound is
 * user-configurable - the 300m lower bound stays fixed (announcing
 * something 300m away or closer is a physics/safety floor, not a
 * preference). Defaults to the engine's own pinned max (2000m) for
 * continuity with Step 3/4's default behaviour. */
export const MIN_ANNOUNCE_DISTANCE_METERS = 500;
export const MAX_ANNOUNCE_DISTANCE_METERS = 3000;
export const DEFAULT_ANNOUNCE_DISTANCE_METERS = ANNOUNCE_MAX_DISTANCE_M;

/** Matches expo-speech's own 0.0 (muted) - 1.0 (max) range. */
export const MIN_VOICE_VOLUME = 0;
export const MAX_VOICE_VOLUME = 1;
export const DEFAULT_VOICE_VOLUME = 1;

/** expo-speech: 1.0 is the normal rate. Not a documented hard range, but
 * 0.5-2.0 covers "noticeably slower" to "noticeably faster" without
 * becoming unintelligible. */
export const MIN_VOICE_RATE = 0.5;
export const MAX_VOICE_RATE = 2;
export const DEFAULT_VOICE_RATE = 1;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface SettingsValues {
  categoriesEnabled: Record<AlertCategory, boolean>;
  announceDistanceMeters: number;
  voiceVolume: number;
  voiceRate: number;
  masterMute: boolean;
}

export const defaultSettingsValues: SettingsValues = {
  categoriesEnabled: {
    POLICE: true,
    ACCIDENT: true,
    HAZARD: true,
    ROAD_CLOSED: true,
    JAM: true,
  },
  announceDistanceMeters: DEFAULT_ANNOUNCE_DISTANCE_METERS,
  voiceVolume: DEFAULT_VOICE_VOLUME,
  voiceRate: DEFAULT_VOICE_RATE,
  masterMute: false,
};

/** The Set<WazeAlertType> shape selectAnnounceableAlerts()'s settings option expects. */
export function enabledTypesFromSettings(
  categoriesEnabled: Record<AlertCategory, boolean>
): ReadonlySet<WazeAlertType> {
  return new Set(ALERT_CATEGORIES.filter((category) => categoriesEnabled[category]));
}
