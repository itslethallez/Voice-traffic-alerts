import { StyleSheet, Text, View } from 'react-native';
import { useTripStore } from '../../store/useTripStore';
import { colors } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';

/**
 * Large, prominent speed readout anchored at the bottom of the Drive
 * screen (Step 13), in the space freed up by condensing the old Report
 * dial into ReportButton. Reads useTripStore's driverSpeedKmh - a
 * read-only radar-UI mirror of DriverState.speedKmh, the same pattern
 * driverPosition/driverHeadingDeg already use.
 */
export function Speedometer() {
  const speedKmh = useTripStore((state) => state.driverSpeedKmh);

  return (
    <View style={styles.container}>
      <Text style={styles.value}>{Math.round(speedKmh)}</Text>
      <Text style={styles.unit}>km/h</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  value: {
    fontFamily: fontFamily.black,
    fontSize: 56,
    color: colors.ink,
  },
  unit: {
    marginLeft: 8,
    fontFamily: fontFamily.medium,
    fontSize: 16,
    color: colors.inkMuted,
  },
});
