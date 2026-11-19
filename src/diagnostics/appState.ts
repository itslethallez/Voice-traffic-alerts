/**
 * Whether Shotgun is on screen right now - and a log line every time
 * that changes.
 *
 * A drive test runs with the phone face down in a cradle, the screen
 * locked, or Waze in front. In all three the app is backgrounded, so a
 * '[speech] spoke via google' line is only *evidence* of background
 * voice if it also says the app wasn't in the foreground at the time.
 * This is the single place that answers that, for the [speech] lines
 * and anything else that needs it.
 *
 * Deliberately free of any `react-native` import: ttsAdapter.ts and
 * googleTts.ts read appStateLabel() on every utterance, and both are
 * unit-tested under the plain ts-jest/node preset with no React Native
 * runtime to transform. The subscription that feeds this lives in
 * useDriveLoop.ts, which is React Native code either way.
 *
 * On Android the screen going off pauses and stops the activity, so
 * AppState reports 'background' - the same value as another app being
 * in front. The two are indistinguishable from JS, which is fine: both
 * are the case the voice has to survive.
 */

/** Mirrors react-native's AppStateStatus without importing it. */
export type AppStateLabel = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

let current: AppStateLabel = 'unknown';

/** Cheap enough to call once per log line. */
export function appStateLabel(): AppStateLabel {
  return current;
}

/** Called once when the Drive screen starts watching AppState. */
export function startAppStateLog(initial: AppStateLabel): void {
  current = initial;
  console.log(`[appstate] ${current} (monitor started)`);
}

/** Called for every AppState change the Drive screen observes. */
export function noteAppStateChange(next: AppStateLabel): void {
  if (next === current) return;
  console.log(`[appstate] ${current} -> ${next}`);
  current = next;
}
