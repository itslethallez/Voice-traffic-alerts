import type { WazeAlertType } from '../api/waze/types';

export type AlertCategory = 'POLICE' | 'ACCIDENT' | 'HAZARD' | 'ROAD_CLOSED' | 'JAM';

export const ALERT_CATEGORIES: AlertCategory[] = [
  'POLICE',
  'ACCIDENT',
  'HAZARD',
  'ROAD_CLOSED',
  'JAM',
];

/** "Announcement distance slider, 500m to 20km." Only the upper bound is
 * user-configurable - the 300m lower bound stays fixed (announcing
 * something 300m away or closer is a physics/safety floor, not a
 * preference). Default is 5km - independent of engine/announceWindow.ts's
 * own ANNOUNCE_MAX_DISTANCE_M, which is just that module's fallback for
 * callers that don't pass explicit settings (tripRuntime.ts, the live
 * path, always does), not something a fresh install actually uses. */
export const MIN_ANNOUNCE_DISTANCE_METERS = 500;
export const MAX_ANNOUNCE_DISTANCE_METERS = 20000;
export const DEFAULT_ANNOUNCE_DISTANCE_METERS = 5000;

/** Cold-start briefing radius: separate from announceDistanceMeters and
 * deliberately wider, since a stationary driver wants broad situational
 * awareness rather than a just-in-time warning. */
export const MIN_BRIEFING_RADIUS_METERS = 1000;
export const MAX_BRIEFING_RADIUS_METERS = 20000;
export const DEFAULT_BRIEFING_RADIUS_METERS = 5000;

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
  briefingRadiusMeters: number;
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
  briefingRadiusMeters: DEFAULT_BRIEFING_RADIUS_METERS,
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
