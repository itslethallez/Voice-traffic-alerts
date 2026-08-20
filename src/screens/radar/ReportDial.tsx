import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTripStore } from '../../store/useTripStore';
import { colors } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';

const HOLD_THRESHOLD_SECONDS = 3;
const CONFIRMATION_DISPLAY_MS = 1500;
const DIAL_SIZE = 132;

/**
 * "Report what you see" (Step 11b) - hold for HOLD_THRESHOLD_SECONDS to
 * log a manual report; releasing early cancels it. Local-only: there is
 * no Waze write API in this integration (see useTripStore's ManualReport
 * doc comment), so this can't submit anywhere - it just becomes a trip
 * record visible in History, the same way a spoken announcement does.
 */
export function ReportDial() {
  const pushManualReport = useTripStore((state) => state.pushManualReport);
  const [heldSeconds, setHeldSeconds] = useState(0);
  const [justReported, setJustReported] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const confirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoldInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const handlePressIn = useCallback(() => {
    if (confirmationTimeoutRef.current !== null) {
      clearTimeout(confirmationTimeoutRef.current);
      confirmationTimeoutRef.current = null;
    }
    setJustReported(false);
    setHeldSeconds(0);
    intervalRef.current = setInterval(() => {
      setHeldSeconds((seconds) => {
        const next = seconds + 1;
        if (next < HOLD_THRESHOLD_SECONDS) return next;

        clearHoldInterval();
        pushManualReport();
        setJustReported(true);
        confirmationTimeoutRef.current = setTimeout(() => {
          setJustReported(false);
        }, CONFIRMATION_DISPLAY_MS);
        return 0;
      });
    }, 1000);
  }, [clearHoldInterval, pushManualReport]);

  const handlePressOut = useCallback(() => {
    clearHoldInterval();
    setHeldSeconds(0);
  }, [clearHoldInterval]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>REPORT WHAT YOU SEE</Text>
      <Text style={styles.subtitle}>
        {justReported ? 'Reported - thanks' : 'Your location is added automatically'}
      </Text>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[styles.dial, heldSeconds > 0 && styles.dialHeld]}
        accessibilityRole="button"
        accessibilityLabel="Hold to report what you see"
      >
        <Text style={styles.dialCount}>{heldSeconds}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    letterSpacing: 1.5,
    color: colors.ink,
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 16,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: colors.inkMuted,
  },
  dial: {
    width: DIAL_SIZE,
    height: DIAL_SIZE,
    borderRadius: DIAL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.report,
    borderWidth: 6,
    borderStyle: 'dotted',
    borderColor: colors.reportDim,
  },
  dialHeld: {
    borderColor: colors.report,
  },
  dialCount: {
    fontFamily: fontFamily.black,
    fontSize: 40,
    color: colors.background,
  },
});
