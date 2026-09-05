import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hud } from '../theme/colors';
import { fontFamily } from '../theme/typography';

export type NavTab = 'map' | 'reports' | 'settings';

interface TabDef {
  key: NavTab;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'map', label: 'MAP' },
  { key: 'reports', label: 'REPORTS' },
  { key: 'settings', label: 'SETTINGS' },
];

interface BottomNavProps {
  active: NavTab;
  onChange: (tab: NavTab) => void;
}

/** Matches DriveScreen's topBar background (hud.ground) so the header and
 * footer read as one consistent dark chrome, rather than the previous
 * white bar that clashed with the dark map-first screens above it. */
export function BottomNav({ active, onChange }: BottomNavProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [styles.tab, isActive && styles.tabActive, pressed && styles.tabPressed]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
            <View style={[styles.indicator, isActive && styles.indicatorActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    minHeight: 64,
    flexDirection: 'row',
    backgroundColor: hud.ground,
    borderTopWidth: 1,
    borderTopColor: hud.rule,
  },
  tab: {
    minHeight: 58,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  tabActive: {
    backgroundColor: 'rgba(38, 185, 154, 0.12)',
  },
  tabPressed: {
    opacity: 0.72,
  },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: hud.muted,
  },
  labelActive: {
    color: hud.accent,
  },
  indicator: {
    width: 28,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  indicatorActive: {
    backgroundColor: hud.accent,
  },
});
