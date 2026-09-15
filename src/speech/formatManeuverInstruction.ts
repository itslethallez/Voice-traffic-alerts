import type { MapboxManeuver } from '../api/mapbox/types';

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0].toLowerCase() + text.slice(1);
}

/**
 * Rounds a live distance-to-maneuver for speech: fine enough close in to
 * sound like it's tracking the map (not a fixed "200 metres" every time),
 * coarse enough further out not to read out jittery GPS noise. Nearest 10m
 * under 100m, nearest 50m from 100m-1000m, nearest 0.1km at/above 1000m
 * (matching formatAnnouncement.ts's formatDistance km rounding).
 */
function formatManeuverDistance(meters: number): string {
  if (meters < 100) {
    return `${Math.round(meters / 10) * 10} metres`;
  }
  if (meters < 1000) {
    return `${Math.round(meters / 50) * 50} metres`;
  }
  const km = Math.round(meters / 100) / 10;
  return km === 1 ? '1 kilometre' : `${km} kilometres`;
}

/**
 * `liveDistanceMeters` is the real, currently-measured distance to the
 * upcoming maneuver (navigationRuntime.ts's own computeStepProgress output)
 * at the moment this happened to be spoken - not a fixed checkpoint number.
 * selectManeuverAnnouncement.ts's checkpoints only decide *when* a cue fires
 * (once per step, at roughly 500m/200m/50m out) so the driver isn't heard a
 * running commentary every GPS tick; what's actually spoken here reflects
 * the live distance at that moment, matching what the map itself shows. 50m
 * or closer is treated as "now" rather than a distance readout - close
 * enough that a number would already be stale advice.
 */
export function formatManeuverInstruction(maneuver: MapboxManeuver, liveDistanceMeters: number): string {
  if (liveDistanceMeters <= 50) {
    return `${maneuver.instruction}, now.`;
  }
  return `In ${formatManeuverDistance(liveDistanceMeters)}, ${lowerFirst(maneuver.instruction)}.`;
}
