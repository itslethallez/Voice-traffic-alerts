import { StyleSheet, View } from 'react-native';
import { hud, instrument } from '../../theme/colors';

/**
 * The driver's position on the radar map (design_handoff_instrument_face) -
 * a static upward triangle, replacing the shipped PulseRings' pulsing-disc
 * treatment. Always points straight up: RadarMap's Camera already rotates
 * the whole map to heading-up, so "up" already means "the direction the
 * driver is travelling" - same reasoning PulseRings documented for its own
 * fixed-up arrow. No animation - the redesign's one rule is that motion in
 * a driving UI should mean something, and the police light bar is the only
 * thing that still moves. HUD face colour pass adds a static glow, still
 * the same white triangle underneath.
 */
export function DriverMark() {
  return <View style={styles.triangle} />;
}

const styles = StyleSheet.create({
  triangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 26,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: instrument.paper,
    shadowColor: hud.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 12,
    shadowOpacity: 0.9,
  },
});
