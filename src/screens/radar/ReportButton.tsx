import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTripStore } from '../../store/useTripStore';
import { colors } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';

const CONFIRMATION_DISPLAY_MS = 1500;

/**
 * One-tap "report police" - replaces the old tap-and-talk Report dial
 * entirely (voice recording removed, not just condensed). A single touch
 * immediately logs the driver's current location and direction of travel
 * as a manual report - no recording, no confirmation delay, fast enough
 * to use safely while driving.
 */
export function ReportButton() {
  const pushManualReport = useTripStore((state) => state.pushManualReport);
  const [justReported, setJustReported] = useState(false);
  const confirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePress = useCallback(() => {
    pushManualReport();
    setJustReported(true);
    if (confirmationTimeoutRef.current !== null) {
      clearTimeout(confirmationTimeoutRef.current);
    }
    confirmationTimeoutRef.current = setTimeout(() => {
      setJustReported(false);
      confirmationTimeoutRef.current = null;
    }, CONFIRMATION_DISPLAY_MS);
  }, [pushManualReport]);

  return (
    <Pressable
      onPress={handlePress}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel="Report police nearby"
    >
      <Text style={styles.icon}>{justReported ? '✅' : '🚓'}</Text>
      <Text style={styles.label}>{justReported ? 'Reported' : 'Report police'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: colors.report,
  },
  icon: {
    fontSize: 16,
    marginRight: 8,
  },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    color: colors.background,
  },
});
