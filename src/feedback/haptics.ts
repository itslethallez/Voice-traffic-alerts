/** Non-audio cue for moments that must never pass silently (arrival, a
 * failed reroute) even with master mute on. react-native is required
 * lazily so node-environment tests that never fire a cue don't load it. */
export function pulseHaptic(pattern: number[]): void {
  try {
    const { Vibration } = require('react-native') as typeof import('react-native');
    Vibration.vibrate(pattern);
  } catch (error) {
    console.warn('[nav] haptic cue failed', error);
  }
}
