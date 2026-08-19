import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';

export type NavTab = 'radio' | 'history' | 'settings';

interface TabDef {
  key: NavTab;
  label: string;
  icon: string;
}

const TABS: TabDef[] = [
  { key: 'radio', label: 'Radio', icon: '📡' },
  { key: 'history', label: 'History', icon: '🕘' },
  { key: 'settings', label: 'Settings', icon: '⚙' },
];

interface BottomNavProps {
  active: NavTab;
  onChange: (tab: NavTab) => void;
}

/** Primary navigation (Step 11) - Radio (the radar-style Drive screen),
 * History and Settings. Always mounted (in App.tsx, alongside whichever
 * screen is active) so switching tabs never unmounts/remounts the Drive
 * screen's location/briefing/announcement lifecycle. */
export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <View style={styles.root}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={styles.tab}
            hitSlop={8}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
          >
            <Text style={[styles.icon, isActive && styles.iconActive]}>{tab.icon}</Text>
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
    backgroundColor: colors.backgroundAccent,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(245, 245, 247, 0.12)',
    paddingTop: 8,
    paddingBottom: 20,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    gap: 2,
  },
  icon: {
    fontSize: 20,
    opacity: 0.5,
  },
  iconActive: {
    opacity: 1,
  },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: colors.inkFaint,
  },
  labelActive: {
    color: colors.ink,
  },
});
