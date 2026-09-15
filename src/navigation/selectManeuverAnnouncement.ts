/**
 * Turn-by-turn's counterpart to engine/selectSpeedCameraWarning.ts's
 * SPEED_WARNING_CHECKPOINTS_M/firedCheckpoints pattern: fixed distance
 * checkpoints per maneuver, never re-fired once passed. These only decide
 * *when* a cue fires, not what's spoken - speech/formatManeuverInstruction.ts
 * reads the real live distance at the moment a checkpoint crossing is
 * detected, so the driver hears an accurate, natural number rather than a
 * fixed "500 metres"/"200 metres" every time. Farthest first - if GPS
 * sampling is sparse enough to jump straight from outside 500m to inside
 * 200m in one update, 500 fires first (briefly "late" but simple and
 * self-correcting - 200 fires on the very next update).
 */
export const MANEUVER_CHECKPOINTS_M = [500, 200, 50] as const;
export type ManeuverCheckpoint = (typeof MANEUVER_CHECKPOINTS_M)[number];

export interface SelectManeuverAnnouncementInput {
  distanceToNextManeuverM: number;
  /** Identifies which upcoming maneuver this distance is measured to -
   * checkpoints are tracked per step index so passing step 2's 200m mark
   * doesn't leave step 3's 200m mark looking already-fired. */
  stepIndex: number;
  firedCheckpoints: ReadonlyMap<number, ReadonlySet<ManeuverCheckpoint>>;
}

export interface ManeuverAnnouncementResult {
  stepIndex: number;
  checkpoint: ManeuverCheckpoint;
}

/** The farthest-unfired checkpoint the driver has now reached for this
 * step's maneuver, or null if none qualifies yet (or all have already fired). */
export function selectManeuverAnnouncement(
  input: SelectManeuverAnnouncementInput
): ManeuverAnnouncementResult | null {
  const { distanceToNextManeuverM, stepIndex, firedCheckpoints } = input;
  const fired = firedCheckpoints.get(stepIndex) ?? new Set<ManeuverCheckpoint>();

  for (const checkpoint of MANEUVER_CHECKPOINTS_M) {
    if (fired.has(checkpoint)) continue;
    if (distanceToNextManeuverM > checkpoint) continue;
    return { stepIndex, checkpoint };
  }
  return null;
}
