import { StyleSheet, Text, View } from 'react-native';
import { useTripStore } from '../../store/useTripStore';
import { instrument } from '../../theme/colors';
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
    <View style={styles.container}>
      <Text style={styles.caption}>SPEED</Text>
      <View style={styles.valueRow}>
        <Text style={styles.value}>{Math.round(speedKmh)}</Text>
        <Text style={styles.unit}>KM/H</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  caption: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 2,
    color: instrument.mutedOnInk,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  value: {
    fontFamily: fontFamily.black,
    fontSize: 76,
    lineHeight: 72,
    letterSpacing: -3,
    color: instrument.paper,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    letterSpacing: 1.5,
    color: instrument.mutedOnInk,
  },
});
