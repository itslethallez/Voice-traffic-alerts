import type { SpeedWarningCheckpoint, WarningTargetKind } from '../engine/selectSpeedCameraWarning';

/**
 * Fires while the driver is confirmed over the limit, or the limit simply
 * couldn't be resolved (see selectSpeedCameraWarning.ts's
 * confirmedSpeeding) - never a bare proximity-only call out when the limit
 * IS known and the driver is under it. Differentiated by kind so a
 * report-triggered warning never falsely claims there's a camera - a
 * corroborated police report and a fixed camera are not the same thing.
 *
 * `checkpointMeters` is the fixed 500/200 checkpoint that fired
 * (selectSpeedCameraWarning.ts's SPEED_WARNING_CHECKPOINTS_M), not the raw
 * distanceMeters at the moment this happened to be spoken - a driver
 * hearing "200 metres ahead" should hear that exact, predictable number
 * every time that checkpoint fires, not a jittery "187 metres" that shifts
 * with GPS sampling.
 *
 * `confirmedSpeeding` gates the "you're currently over the limit" claim
 * specifically - false means the speed limit lookup never resolved there
 * (unfetched, or genuinely unavailable - roadSpeedLimit.ts only covers
 * major road classes), so this app has no basis to assert the driver is
 * speeding, only that the camera/report is close. Saying so anyway would
 * be a false claim, not just an unhelpful one.
 */
export function formatSpeedCameraWarning(
  kind: WarningTargetKind,
  checkpointMeters: SpeedWarningCheckpoint,
  confirmedSpeeding: boolean
): string {
  const subject = kind === 'camera' ? 'Speed camera' : 'Police reported';
  if (!confirmedSpeeding) {
    return `${subject} ${checkpointMeters} metres ahead.`;
  }
  return `${subject} ${checkpointMeters} metres ahead, you're currently over the limit. Reduce speed immediately.`;
}
