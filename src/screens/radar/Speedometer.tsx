import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTripStore } from '../../store/useTripStore';
import { hud } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';

/**
 * The Drive screen's speed readout (design_handoff_instrument_face) - the
 * single largest numeral in the app, since speed is the one thing read
 * while actually moving. Reads useTripStore's driverSpeedKmh, unchanged
 * from the shipped version - only the visual treatment changes here.
 */
export function Speedometer() {
  const speedKmh = useTripStore((state) => state.driverSpeedKmh);

  return (
    <LinearGradient colors={['#0A1E30', '#060D16']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.container}>
      <View style={styles.captionRow}>
        <Text style={styles.caption}>SPEED</Text>
        <Text style={styles.hint}>ONE TAP TO REPORT</Text>
      </View>
      <View style={styles.valueRow}>
        <Text style={styles.value}>{Math.round(speedKmh)}</Text>
        <Text style={styles.unit}>KM/H</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 0,
    flexShrink: 0,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  caption: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 2,
    color: hud.accent,
  },
  hint: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: hud.accentBright,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  value: {
    fontFamily: fontFamily.black,
    fontSize: 60,
    lineHeight: 58,
    letterSpacing: -2,
    color: hud.ink,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    letterSpacing: 1.5,
    color: hud.accent,
  },
});
