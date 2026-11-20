import type { WazeAlertType } from '../api/waze/types';

/**
 * How far out each kind of alert is announced, and briefed.
 *
 * Per-type, decided 20 Nov 2026: what's worth hearing about from 5 km out
 * (a crash or a closure can change your trip) isn't what's worth hearing
 * about from 5 km out for a camera or a pothole. The driver doesn't see
 * these numbers - Settings offers one Close / Normal / Far control that
 * scales all of them together (ALERT_DISTANCE_MULTIPLIER). This replaced
 * the old single warn-me slider and brief-me slider.
 *
 * Distances are along the road where the road is known
 * (road/roadContextRuntime.ts), straight-line otherwise.
 */
export type AlertDistanceSetting = 'close' | 'normal' | 'far';

export const ALERT_DISTANCE_SETTINGS: readonly AlertDistanceSetting[] = ['close', 'normal', 'far'];

export const ALERT_DISTANCE_MULTIPLIER: Record<AlertDistanceSetting, number> = {
  close: 0.5,
  normal: 1,
  far: 1.5,
};

export const DEFAULT_ALERT_DISTANCE_SETTING: AlertDistanceSetting = 'normal';

/** Normal-setting distance for each type, in metres. */
export const BASE_ALERT_DISTANCE_M: Readonly<Record<string, number>> = {
  FIXED_CAMERA: 2_000,
  MOBILE_CAMERA: 2_000,
  POLICE: 5_000,
  ACCIDENT: 5_000,
  ROAD_CLOSED: 5_000,
  JAM: 5_000,
  HAZARD: 2_000,
  ROADKILL: 2_000,
};

/** Anything not listed above (a new feed type) gets the shorter distance -
 * the quieter default for something nobody has decided on yet. */
const FALLBACK_ALERT_DISTANCE_M = 2_000;

export function alertDistanceMeters(type: WazeAlertType, setting: AlertDistanceSetting): number {
  const base = BASE_ALERT_DISTANCE_M[type] ?? FALLBACK_ALERT_DISTANCE_M;
  return base * ALERT_DISTANCE_MULTIPLIER[setting];
}

/** The largest per-type distance at this setting - what the poll box, the
 * map's range ring and the on-map alert list have to cover. */
export function maxAlertDistanceMeters(setting: AlertDistanceSetting): number {
  return Math.max(...Object.values(BASE_ALERT_DISTANCE_M)) * ALERT_DISTANCE_MULTIPLIER[setting];
}

/** A per-type distance function for one setting, for selectAlerts.ts. */
export function alertDistanceFor(setting: AlertDistanceSetting): (type: WazeAlertType) => number {
  return (type) => alertDistanceMeters(type, setting);
}

export function isAlertDistanceSetting(value: unknown): value is AlertDistanceSetting {
  return value === 'close' || value === 'normal' || value === 'far';
}
