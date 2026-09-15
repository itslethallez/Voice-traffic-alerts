import type { MapboxManeuver } from '../api/mapbox/types';
import type { ManeuverCheckpoint } from '../navigation/selectManeuverAnnouncement';

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0].toLowerCase() + text.slice(1);
}

/**
 * `checkpointMeters` is the fixed 500/200/50 checkpoint that fired, not
 * the raw live distance at the moment this happened to be spoken - same
 * "predictable number every time" rule formatSpeedCameraWarning.ts already
 * follows, so a driver hears "in 200 metres" consistently rather than a
 * jittery "187 metres" that shifts with GPS sampling. The 50m checkpoint
 * is treated as "now" rather than "in 50 metres" - close enough that a
 * distance readout would already be stale advice.
 */
export function formatManeuverInstruction(maneuver: MapboxManeuver, checkpointMeters: ManeuverCheckpoint): string {
  if (checkpointMeters <= 50) {
    return `${maneuver.instruction}, now.`;
  }
  return `In ${checkpointMeters} metres, ${lowerFirst(maneuver.instruction)}.`;
}
