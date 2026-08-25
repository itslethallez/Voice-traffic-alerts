import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTripStore } from '../../store/useTripStore';
import { instrument } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';

const CONFIRMATION_DISPLAY_MS = 1500;

/**
 * One-tap "report police" (design_handoff_instrument_face): the whole
 * report control, restyled to a full-height inverted block - same
 * `pushManualReport()` + 1500ms-confirmation behaviour as the shipped
 * version, no icon, no pill shape. Every Pressable in the redesign inverts
 * on press; since this one is already inverted at rest (paper ground, ink
 * text), a press drops it to ink/paper instead.
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
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      accessibilityRole="button"
      accessibilityLabel="Report police nearby"
    >
      {({ pressed }) => (
        <>
          <Text style={[styles.caption, pressed && styles.textPressed]}>ONE TAP</Text>
          <Text style={[styles.label, pressed && styles.textPressed]}>
            {justReported ? 'REPORTED' : 'REPORT\nPOLICE'}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 150,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'stretch',
    borderLeftWidth: 2,
    borderLeftColor: instrument.paper,
    backgroundColor: instrument.paper,
    justifyContent: 'flex-end',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  buttonPressed: {
    backgroundColor: instrument.ink,
  },
  caption: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: instrument.ink,
    opacity: 0.7,
  },
  label: {
    marginTop: 2,
    fontFamily: fontFamily.black,
    fontSize: 20,
    letterSpacing: 0.5,
    lineHeight: 21,
    color: instrument.ink,
  },
  textPressed: {
    color: instrument.paper,
  },
});
