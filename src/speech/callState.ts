import { PermissionsAndroid, Platform } from 'react-native';
import CallDetectorManager, { type CallDetectionEvent } from 'react-native-call-detection';

/**
 * Android's call-state events ("Offhook" while a call is dialing/active/on
 * hold, "Incoming" while ringing) and iOS's CallKit-backed events
 * ("Dialing", "Incoming", "Connected") are two different vocabularies for
 * the same concept - collapsed here into one active/inactive signal so the
 * rest of the app (ttsAdapter.ts) never needs to know which platform it's
 * on. "Missed" (Android only, a ring that ended without connecting) is
 * inactive - nothing was ever actually speaking over it.
 */
const ACTIVE_EVENTS = new Set<CallDetectionEvent>(['Offhook', 'Incoming', 'Dialing', 'Connected']);
const INACTIVE_EVENTS = new Set<CallDetectionEvent>(['Disconnected', 'Missed']);

export type CallStateEvent = 'active' | 'inactive';
type Listener = (event: CallStateEvent) => void;

let isCallActive = false;
let detector: CallDetectorManager | null = null;
const listeners = new Set<Listener>();

/** Read by ttsAdapter.ts's speakAsync() to skip speaking entirely while a
 * call is active - see startCallStateMonitoring's doc comment for what
 * happens when the native module isn't available or permission is denied. */
export function isPhoneCallActive(): boolean {
  return isCallActive;
}

/** useDriveLoop.ts subscribes to this to cut off whatever's already
 * mid-utterance the instant a call starts, rather than waiting for it to
 * finish naturally. */
export function addCallStateListener(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function handleEvent(event: CallDetectionEvent): void {
  if (ACTIVE_EVENTS.has(event) && !isCallActive) {
    isCallActive = true;
    listeners.forEach((listener) => listener('active'));
  } else if (INACTIVE_EVENTS.has(event) && isCallActive) {
    isCallActive = false;
    listeners.forEach((listener) => listener('inactive'));
  }
}

/**
 * Requested here, ahead of constructing CallDetectorManager, rather than
 * via its own readPhoneNumberAndroid path - that path fires
 * PermissionsAndroid.request() and NativeCallDetectorAndroid.startListener()
 * with no ordering between them, so on a first-ever launch (before the user
 * has answered the prompt) the native listener can start before the
 * permission is actually granted and silently never receive call-state
 * updates for the rest of that app session.
 */
async function ensureAndroidPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const alreadyGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE);
  if (alreadyGranted) return true;

  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE, {
    title: 'Phone state permission',
    message: 'Voice Traffic Alerts uses this to go quiet automatically instead of talking over a phone call.',
    buttonPositive: 'OK',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Best-effort: on a platform/build where the native module isn't linked
 * (Expo Go, web, a dev client built before this dependency was added) or
 * where the driver denies the permission, isPhoneCallActive() simply never
 * becomes true - announcements keep working exactly as before this
 * existed, they just won't go quiet for calls. Call once per app lifetime
 * (useDriveLoop.ts's mount-once effect); a second call while already
 * monitoring is a no-op.
 */
export async function startCallStateMonitoring(): Promise<void> {
  if (detector) return;

  const granted = await ensureAndroidPermission();
  if (!granted) {
    console.warn('[call-detection] READ_PHONE_STATE denied - announcements may play over phone calls');
    return;
  }

  detector = new CallDetectorManager(handleEvent, false, () =>
    console.warn('[call-detection] permission denied - announcements may play over phone calls')
  );
}

export function stopCallStateMonitoring(): void {
  detector?.dispose();
  detector = null;
  isCallActive = false;
}
