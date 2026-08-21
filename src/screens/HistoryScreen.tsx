import { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import type { VoiceNote } from '../store/useTripStore';
import { useTripStore } from '../store/useTripStore';
import { colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { formatRelativeTime } from './formatRelativeTime';
import { VoiceNoteRow } from './radar/VoiceNoteRow';

type HistoryRow =
  | { kind: 'announcement'; id: string; atMs: number; text: string }
  | { kind: 'manualReport'; id: string; atMs: number; voiceNote: VoiceNote | null };

/**
 * Step 11 stub - lists this trip's announcements and manual reports
 * (Step 11b's Report dial), both already tracked in useTripStore for the
 * Drive screen's own overlays. A real persisted history is future work,
 * out of scope for this step.
 */
export function HistoryScreen() {
  const recentAnnouncements = useTripStore((state) => state.recentAnnouncements);
  const manualReports = useTripStore((state) => state.manualReports);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const rows = useMemo<HistoryRow[]>(() => {
    const announcementRows: HistoryRow[] = recentAnnouncements.map((announcement) => ({
      kind: 'announcement',
      id: `${announcement.alertId}-${announcement.announcedAtMs}`,
      atMs: announcement.announcedAtMs,
      text: announcement.text,
    }));
    const manualReportRows: HistoryRow[] = manualReports.map((report) => ({
      kind: 'manualReport',
      id: report.id,
      atMs: report.createdAtMs,
      voiceNote: report.voiceNote,
    }));
    return [...announcementRows, ...manualReportRows].sort((a, b) => b.atMs - a.atMs);
  }, [recentAnnouncements, manualReports]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <Text style={styles.title}>History</Text>

        {rows.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Nothing announced or reported yet this trip.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {rows.map((row) => (
              <View key={row.id} style={styles.row}>
                <Text style={styles.rowText}>
                  {row.kind === 'manualReport' ? 'You reported something nearby' : row.text}
                </Text>
                <Text style={styles.rowTime}>{formatRelativeTime(row.atMs, now)}</Text>
                {row.kind === 'manualReport' && row.voiceNote ? (
                  <VoiceNoteRow uri={row.voiceNote.uri} durationMs={row.voiceNote.durationMs} />
                ) : null}
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
