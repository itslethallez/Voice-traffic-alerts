import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTripStore } from '../../store/useTripStore';
import { hud } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';

const CONFIRMATION_DISPLAY_MS = 1500;

/** A same-colour-twice "gradient" renders as a flat fill - used for the
 * pressed state so it can share the same LinearGradient element as the
 * at-rest vertical gradient rather than needing a second background layer. */
const RESTING_GRADIENT = ['#14395C', '#0A2338'] as const;
const PRESSED_GRADIENT = [hud.accent, hud.accent] as const;

/**
 * One-tap "report police" (HUD face colour pass, on top of
 * design_handoff_instrument_face's layout): the whole report control, no
 * longer inverted at rest - a vertical gradient ground instead - same
 * `pushManualReport()` + 1500ms-confirmation behaviour as the shipped
 * version, no icon, no pill shape. Pressed state now inverts to a solid
 * `hud.accent` ground instead of the old ink/paper swap.
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
      {({ pressed }) => (
        <LinearGradient
          colors={pressed ? PRESSED_GRADIENT : RESTING_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.buttonInner}
        >
          <Text style={[styles.caption, pressed && styles.textPressed]}>ONE TAP</Text>
          <Text style={[styles.label, pressed && styles.textPressed]}>
            {justReported ? 'REPORTED' : 'REPORT\nPOLICE'}
          </Text>
        </LinearGradient>
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
    borderLeftWidth: 1,
    borderLeftColor: hud.ruleStrong,
  },
  buttonInner: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  caption: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: hud.accentBright,
  },
  label: {
    marginTop: 2,
    fontFamily: fontFamily.black,
    fontSize: 20,
    letterSpacing: 0.5,
    lineHeight: 21,
    color: hud.rowTitle,
  },
  textPressed: {
    color: hud.ground,
  },
});
