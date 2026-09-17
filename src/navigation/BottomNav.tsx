import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { alpha, colors, radii, typography } from '../theme/tokens';

export type NavTab = 'map' | 'settings';

interface TabDef {
  key: NavTab;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'map', label: 'MAP' },
  { key: 'settings', label: 'SETTINGS' },
];

interface BottomNavProps {
  active: NavTab;
  onChange: (tab: NavTab) => void;
}

/** Two-tab chrome — the alert list moved into DriveScreen's bottom sheet,
 * so the only destinations left are the map itself and settings. */
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
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: {
    minHeight: 58,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  tabActive: {
    backgroundColor: alpha(colors.accent, 0.12),
  },
  tabPressed: {
    opacity: 0.72,
  },
  label: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textMuted,
  },
  labelActive: {
    color: colors.accent,
  },
  indicator: {
    width: 28,
    height: 3,
    borderRadius: radii.sm,
    backgroundColor: 'transparent',
  },
  indicatorActive: {
    backgroundColor: colors.accent,
  },
});
