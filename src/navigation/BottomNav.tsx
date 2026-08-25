import { Pressable, StyleSheet, Text, View } from 'react-native';
import { instrument } from '../theme/colors';
import { fontFamily } from '../theme/typography';

export type NavTab = 'radio' | 'history' | 'settings';

interface TabDef {
  key: NavTab;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'radio', label: 'RADIO' },
  { key: 'history', label: 'HISTORY' },
  { key: 'settings', label: 'SETTINGS' },
];

interface BottomNavProps {
  active: NavTab;
  onChange: (tab: NavTab) => void;
}

/**
 * Primary navigation (Step 11), restyled for the Instrument redesign
 * (design_handoff_instrument_face): no icons - three equal ruled cells,
 * the active tab marked by a 5px top bar instead of an icon/colour change.
 * Always mounted (in App.tsx, alongside whichever screen is active) so
 * switching tabs never unmounts/remounts the Drive screen's
 * location/briefing/announcement lifecycle. Always sits on `instrument.ink`
 * ground across all three screens, so it can use the tokens directly.
 */
export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <View style={styles.root}>
      {TABS.map((tab, index) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={[styles.tab, index > 0 && styles.tabDivider, isActive && styles.tabActive]}
            hitSlop={8}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    borderTopWidth: 2,
    borderTopColor: instrument.paper,
  },
  tab: {
    flex: 1,
    paddingTop: 14,
    paddingBottom: 22,
    alignItems: 'center',
  },
  tabDivider: {
    borderLeftWidth: 2,
    borderLeftColor: instrument.paper,
  },
  tabActive: {
    borderTopWidth: 5,
    borderTopColor: instrument.paper,
    marginTop: -2,
  },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    letterSpacing: 1.5,
    color: instrument.mutedOnInk,
  },
  labelActive: {
    fontFamily: fontFamily.black,
    color: instrument.paper,
  },
});
