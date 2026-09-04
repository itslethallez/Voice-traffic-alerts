import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#DCE7E5',
  },
  tab: {
    minHeight: 58,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  tabActive: {
    backgroundColor: '#F3FAF8',
  },
  tabPressed: {
    opacity: 0.72,
  },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: '#6B7D81',
  },
  labelActive: {
    color: '#087566',
  },
  indicator: {
    width: 28,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  indicatorActive: {
    backgroundColor: '#26B99A',
  },
});
