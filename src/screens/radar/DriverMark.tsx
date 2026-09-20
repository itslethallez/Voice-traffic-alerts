import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { colors } from '../../theme/tokens';
import { DRIVER_CAR_SVG } from './driverCarGlyph';

/**
 * The driver's position on the radar map (design_handoff_instrument_face
 * + §7's Navigate personality) - a top-down car silhouette inside an
 * accent halo, replacing the static upward triangle. Always points
 * straight up: RadarMap's Camera already rotates the whole map to
 * heading-up, so "up" already means "the direction the driver is
 * travelling". No animation - the redesign's one rule is that motion in
 * a driving UI should mean something, and the police light bar is the
 * only thing that still moves.
 */
export function DriverMark() {
  return (
    <View style={styles.halo}>
      <SvgXml xml={DRIVER_CAR_SVG} width={34} height={45} />
    </View>
  );
}

const styles = StyleSheet.create({
  halo: {
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 14,
    shadowOpacity: 0.9,
  },
});
