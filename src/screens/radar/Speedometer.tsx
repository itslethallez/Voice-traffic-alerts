import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTripStore } from '../../store/useTripStore';
import { hud } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';

/** Matches ReportBar's REPORT_DIAL_SIZE (design reference: the two
 * circular controls are the same size, mirrored left/right in the bottom
 * bar) - kept as a separate constant since the two files have no shared
 * import today and this is a small, easily-eyeballed layout constant. */
const SPEED_DIAL_SIZE = 112;

/**
 * The Drive screen's speed readout (2026-09 redesign: a circular dial
 * mirroring ReportBar's REPORT control, replacing the old full-width bar).
 * Reads useTripStore's driverSpeedKmh, unchanged from the shipped version -
 * only the visual treatment changes here.
 */
export function Speedometer() {
  const speedKmh = useTripStore((state) => state.driverSpeedKmh);

  return (
    <LinearGradient colors={['#0A1E30', '#060D16']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.container}>
      <Text style={styles.caption}>SPEED</Text>
      <View style={styles.valueRow}>
        <Text style={styles.value}>{Math.round(speedKmh)}</Text>
      </View>
      <Text style={styles.unit}>KM/H</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SPEED_DIAL_SIZE,
    height: SPEED_DIAL_SIZE,
    borderRadius: SPEED_DIAL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: hud.accent,
  },
  caption: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: hud.accent,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  value: {
    fontFamily: fontFamily.black,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: -1,
    color: hud.ink,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: hud.accent,
  },
});
