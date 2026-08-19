import { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useTripStore } from '../store/useTripStore';
import { colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { formatRelativeTime } from './formatRelativeTime';

/**
 * Step 11 stub - lists this trip's announcements (already tracked in
 * useTripStore for the Drive screen's own recent-announcements overlay).
 * Manual reports (Step 11b) will show up here too once that lands; a
 * real persisted history is future work, out of scope for this step.
 */
export function HistoryScreen() {
  const recentAnnouncements = useTripStore((state) => state.recentAnnouncements);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <Text style={styles.title}>History</Text>

        {recentAnnouncements.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Nothing announced yet this trip.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {recentAnnouncements.map((announcement) => (
              <View key={`${announcement.alertId}-${announcement.announcedAtMs}`} style={styles.row}>
                <Text style={styles.rowText}>{announcement.text}</Text>
                <Text style={styles.rowTime}>
                  {formatRelativeTime(announcement.announcedAtMs, now)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 24,
  },
  title: {
    marginTop: 16,
    marginBottom: 24,
    fontFamily: fontFamily.black,
    fontSize: 32,
    color: colors.ink,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyText: {
    fontFamily: fontFamily.regular,
    fontSize: 16,
    color: colors.inkMuted,
    textAlign: 'center',
  },
  list: {
    gap: 12,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.backgroundAccent,
  },
  rowText: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    color: colors.ink,
  },
  rowTime: {
    marginTop: 4,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: colors.inkMuted,
  },
});
