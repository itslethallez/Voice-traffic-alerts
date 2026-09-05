import * as Location from 'expo-location';

export interface LocationPermissionResult {
  foregroundGranted: boolean;
  backgroundGranted: boolean;
  /** One-line explanation for the user, or null when nothing needs explaining. */
  explanation: string | null;
}

export const FOREGROUND_DENIED_EXPLANATION =
  'Voice alerts need your location to know what is ahead. Enable location access in Settings.';

export const BACKGROUND_DENIED_EXPLANATION =
  'Background location is off, so alerts only work while this screen is open.';

/**
 * Requests foreground permission first, then - only if that's granted -
 * background permission separately, matching the two distinct edge
 * cases in the spec: foreground denied (can't function at all) and
 * background denied (app still works, just foreground-only).
 */
export async function ensureLocationPermissions(): Promise<LocationPermissionResult> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== Location.PermissionStatus.GRANTED) {
    return { foregroundGranted: false, backgroundGranted: false, explanation: FOREGROUND_DENIED_EXPLANATION };
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== Location.PermissionStatus.GRANTED) {
    return { foregroundGranted: true, backgroundGranted: false, explanation: BACKGROUND_DENIED_EXPLANATION };
  }

  return { foregroundGranted: true, backgroundGranted: true, explanation: null };
}
