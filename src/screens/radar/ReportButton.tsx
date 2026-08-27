import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTripStore, type ManualReportCategory } from '../../store/useTripStore';
import { hud } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';

const CONFIRMATION_DISPLAY_MS = 1500;

/** A same-colour-twice "gradient" renders as a flat fill - used for the
 * pressed state so it can share the same LinearGradient element as the
 * at-rest vertical gradient rather than needing a second background layer. */
const RESTING_GRADIENT = ['#14395C', '#0A2338'] as const;
const PRESSED_GRADIENT = [hud.accent, hud.accent] as const;

type PickerStep = 'idle' | 'category' | 'subtype';

const CATEGORY_OPTIONS: { category: ManualReportCategory; label: string }[] = [
  { category: 'POLICE', label: 'POLICE' },
  { category: 'ACCIDENT', label: 'ACCIDENT' },
  { category: 'HAZARD', label: 'HAZARD' },
];

/** Waze's own POLICE subtype strings (policeSubtype.ts) are humanised
 * generically ("POLICE_VISIBLE" -> "Police Visible"), so re-using that same
 * prefix convention for the app's own driver-submitted reports means
 * History's alertTypeMeta lookup renders these correctly for free. */
const POLICE_SUBTYPE_OPTIONS: { subtype: string; label: string }[] = [
  { subtype: 'POLICE_VISIBLE', label: 'VISIBLE' },
  { subtype: 'POLICE_HIDING', label: 'HIDDEN' },
];

/**
 * Report picker (on top of the HUD face colour pass): at rest, a single
 * generic "REPORT" control; tapping it expands the same footprint in place
 * into a category list (Police / Accident / Hazard) rather than opening a
 * modal. Picking Police drills into one more in-place step for a
 * Visible/Hidden sub-choice - Accident and Hazard submit immediately, same
 * as the old one-tap-police flow did.
 */
export function ReportButton() {
  const pushManualReport = useTripStore((state) => state.pushManualReport);
  const [step, setStep] = useState<PickerStep>('idle');
  const [justReported, setJustReported] = useState(false);
  const confirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (confirmationTimeoutRef.current !== null) {
        clearTimeout(confirmationTimeoutRef.current);
      }
    },
    []
  );

  const submit = useCallback(
    (category: ManualReportCategory, subtype: string | null) => {
      pushManualReport(category, subtype);
      setStep('idle');
      setJustReported(true);
      if (confirmationTimeoutRef.current !== null) {
        clearTimeout(confirmationTimeoutRef.current);
      }
      confirmationTimeoutRef.current = setTimeout(() => {
        setJustReported(false);
        confirmationTimeoutRef.current = null;
      }, CONFIRMATION_DISPLAY_MS);
    },
    [pushManualReport]
  );

  const handleCategoryPress = useCallback(
    (category: ManualReportCategory) => {
      if (category === 'POLICE') {
        setStep('subtype');
        return;
      }
      submit(category, null);
    },
    [submit]
  );

  if (step === 'category') {
    return (
      <View style={styles.button}>
        <Pressable
          onPress={() => setStep('idle')}
          style={styles.pickerHeader}
          accessibilityRole="button"
          accessibilityLabel="Cancel report"
        >
          <Text style={styles.pickerHeaderText}>REPORT ✕</Text>
        </Pressable>
        {CATEGORY_OPTIONS.map((option) => (
          <PickerRow key={option.category} label={option.label} onPress={() => handleCategoryPress(option.category)} />
        ))}
      </View>
    );
  }

  if (step === 'subtype') {
    return (
      <View style={styles.button}>
        <Pressable
          onPress={() => setStep('category')}
          style={styles.pickerHeader}
          accessibilityRole="button"
          accessibilityLabel="Back to report categories"
        >
          <Text style={styles.pickerHeaderText}>‹ POLICE</Text>
        </Pressable>
        {POLICE_SUBTYPE_OPTIONS.map((option) => (
          <PickerRow key={option.subtype} label={option.label} onPress={() => submit('POLICE', option.subtype)} />
        ))}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => setStep('category')}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel="Report a hazard"
    >
      {({ pressed }) => (
        <LinearGradient
          colors={pressed ? PRESSED_GRADIENT : RESTING_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.buttonInner}
        >
          <Text style={[styles.caption, pressed && styles.textPressed]}>TAP FOR</Text>
          <Text style={[styles.label, pressed && styles.textPressed]}>{justReported ? 'REPORTED' : 'REPORT'}</Text>
        </LinearGradient>
      )}
    </Pressable>
  );
}

function PickerRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.pickerRow, pressed && styles.pickerRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Report ${label.toLowerCase()}`}
    >
      {({ pressed }) => <Text style={[styles.pickerRowText, pressed && styles.textPressed]}>{label}</Text>}
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
    backgroundColor: '#0A2338',
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
  pickerHeader: {
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: hud.rule,
  },
  pickerHeaderText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1,
    color: hud.accentBright,
  },
  pickerRow: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: hud.rowRule,
  },
  pickerRowPressed: {
    backgroundColor: hud.accent,
  },
  pickerRowText: {
    fontFamily: fontFamily.black,
    fontSize: 14,
    letterSpacing: 0.5,
    color: hud.rowTitle,
  },
});
