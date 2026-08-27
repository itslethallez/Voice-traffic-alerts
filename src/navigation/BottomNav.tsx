import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { hud } from '../theme/colors';
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
 * the active tab marked by a top bar. HUD face colour pass adds the
 * active-tab glow (gradient wash + glow bar) on top of that layout.
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
            {isActive ? (
              <LinearGradient
                colors={['rgba(47,155,224,0.16)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
            {isActive ? <View style={styles.activeGlowBar} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: hud.rule,
  },
  tab: {
    flex: 1,
    paddingTop: 14,
    paddingBottom: 22,
    alignItems: 'center',
  },
  tabDivider: {
    borderLeftWidth: 1,
    borderLeftColor: hud.rule,
  },
  tabActive: {
    borderTopWidth: 2,
    borderTopColor: hud.accent,
    marginTop: -1,
  },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    letterSpacing: 1.5,
    color: hud.muted,
  },
  labelActive: {
    fontFamily: fontFamily.black,
    color: hud.accent,
  },
  activeGlowBar: {
    position: 'absolute',
    bottom: 16,
    left: '50%',
    marginLeft: -22,
    width: 44,
    height: 2,
    backgroundColor: hud.accent,
    shadowColor: hud.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 2,
    elevation: 2,
  },
});
