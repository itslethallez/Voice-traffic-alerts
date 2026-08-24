import type { WarningTargetKind } from '../engine/selectSpeedCameraWarning';

/**
 * Fires only while the driver is actually over the limit (see
 * selectSpeedCameraWarning.ts) - never a proximity-only "camera here" call
 * out, so this is deliberately blunt. Differentiated by kind so a
 * report-triggered warning never falsely claims there's a camera - a
 * corroborated police report and a fixed camera are not the same thing.
 */
export function formatSpeedCameraWarning(kind: WarningTargetKind): string {
  const lead = kind === 'camera' ? "Speed camera ahead, you're currently over the limit." : "Police reported ahead, you're currently over the limit.";
  return `${lead} Reduce speed immediately.`;
}
