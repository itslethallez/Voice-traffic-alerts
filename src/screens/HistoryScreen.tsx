import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { compassDirection } from '../geo/bearing';
import { announcementLocation } from '../speech/formatAnnouncement';
import type { RecentAnnouncement } from '../speech/types';
import { useTripStore, type ManualReport } from '../store/useTripStore';
import { alertTypeMeta } from '../theme/alertTypeMeta';
import { colors, hud, instrument } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { formatRelativeTime } from './formatRelativeTime';
import { PoliceLightBar } from './radar/PoliceLightBar';
import { splitCompactDistance } from './radar/formatCompactDistance';

/** How far a report row can be dragged to reveal its delete action - wide
 * enough for the DELETE label, matching the usual iOS/Android swipe-action
 * width rather than a bespoke number. */
const DELETE_REVEAL_WIDTH = 88;

/** HUD face has no ink/paper inversion to mark the newest row (that was an
 * `instrument` face-only concept) - this reuses the same accent gradient
 * wash convention DriveScreen's ledger rows and BottomNav's active tab
 * already use instead, tinted with hud.accent. */
const NEWEST_ROW_GRADIENT = {
  colors: ['rgba(47,155,224,0.20)', 'rgba(47,155,224,0.04)', 'rgba(47,155,224,0)'] as const,
  locations: [0, 0.6, 1] as const,
};

/** "just now" -> "NOW", "6m ago" -> "6M", "45s ago" -> "45S" - the ledger's
 * compact tabular time column, built from the same formatRelativeTime()
 * used elsewhere rather than re-deriving the thresholds. */
function formatLedgerTime(atMs: number, nowMs: number): string {
  const relative = formatRelativeTime(atMs, nowMs);
  return relative === 'just now' ? 'NOW' : relative.replace(' ago', '').toUpperCase();
}

interface SpokenRow {
  kind: 'spoken';
  id: string;
  atMs: number;
  announcement: RecentAnnouncement;
}
interface ReportRow {
  kind: 'report';
  id: string;
  atMs: number;
  report: ManualReport;
}
type HistoryRow = SpokenRow | ReportRow;

/**
 * History - two independently-sorted groups (what was said to the driver,
 * what the driver reported), each with its own newest-first order and its
 * own newest-row accent highlight. The shipped version's single merged,
 * flat list is gone.
 */
export function HistoryScreen() {
  const recentAnnouncements = useTripStore((state) => state.recentAnnouncements);
  const manualReports = useTripStore((state) => state.manualReports);
  const removeManualReport = useTripStore((state) => state.removeManualReport);
  const tripStartedAtMs = useTripStore((state) => state.tripStartedAtMs);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const spokenRows = useMemo<SpokenRow[]>(
    () =>
      [...recentAnnouncements]
        .sort((a, b) => b.announcedAtMs - a.announcedAtMs)
        .map((announcement) => ({
          kind: 'spoken' as const,
          id: `${announcement.alertId}-${announcement.announcedAtMs}`,
          atMs: announcement.announcedAtMs,
          announcement,
        })),
    [recentAnnouncements]
  );
  const reportRows = useMemo<ReportRow[]>(
    () =>
      [...manualReports]
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .map((report) => ({ kind: 'report' as const, id: report.id, atMs: report.createdAtMs, report })),
    [manualReports]
  );

  const totalCount = spokenRows.length + reportRows.length;
  const tripMinutes = tripStartedAtMs !== null ? Math.max(0, Math.round((now - tripStartedAtMs) / 60_000)) : 0;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Image source={require('../../assets/streetwise-icon.png')} style={styles.brandIcon} resizeMode="contain" />
            <Text style={styles.title}>HISTORY</Text>
            <View style={styles.headerSpacer} />
            <Text style={styles.count}>{totalCount}</Text>
          </View>
          {/* Only the "SPOKEN TO YOU" group below is actually trip-scoped
           * (recentAnnouncements resets every trip) - "YOUR REPORTS" is
           * hydrated from the backend and deliberately survives a relaunch
           * (see ManualReport's doc comment in useTripStore.ts), so this
           * line describes trip duration without claiming it scopes the
           * whole screen or the {totalCount} badge above. */}
          <Text style={styles.metaLine}>TRIP TIME · {tripMinutes} MIN</Text>
        </View>

        {totalCount === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Nothing announced this trip, and no reports on record.</Text>
          </View>
        ) : (
          <View style={styles.content}>
            {spokenRows.length > 0 ? (
              <>
                <View style={styles.groupLabelBottomOnly}>
                  <Text style={styles.groupLabelText}>SPOKEN TO YOU</Text>
                </View>
                {spokenRows.map((row, index) => (
                  <SpokenHistoryRow key={row.id} row={row} nowMs={now} highlighted={index === 0} />
                ))}
              </>
            ) : null}

            {reportRows.length > 0 ? (
              <>
                <View style={styles.groupLabel}>
                  <Text style={styles.groupLabelText}>YOUR REPORTS</Text>
                </View>
                {reportRows.map((row, index) => (
                  <SwipeToDeleteRow key={row.id} onDelete={() => removeManualReport(row.report.localKey)}>
                    <ReportHistoryRow row={row} nowMs={now} highlighted={index === 0} />
                  </SwipeToDeleteRow>
                ))}
              </>
            ) : null}
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

function SpokenHistoryRow({ row, nowMs, highlighted }: { row: SpokenRow; nowMs: number; highlighted: boolean }) {
  const { candidate } = row.announcement;
  const alert = candidate.alert;
  const meta = alertTypeMeta(alert.type, alert.subtype);
  const location = announcementLocation(candidate);
  const { value, unit } = splitCompactDistance(candidate.distanceMeters);
  const place = location.street && location.area ? `${location.street}, ${location.area}` : (location.street ?? location.area);
  // A briefing candidate's driverHeadingDeg is a meaningless placeholder
  // (there's no direction of travel while stationary at a cold start) -
  // formatBriefingAlert() itself never speaks a "-bound" for exactly this
  // reason, so this must not display one either.
  const directionPrefix = row.announcement.isBriefing ? '' : `${location.direction.toUpperCase()}BOUND · `;
  const subtitle = `${place ? `${place.toUpperCase()} · ` : ''}${directionPrefix}${value} ${unit} AHEAD`;

  return (
    <View style={styles.row}>
      {highlighted ? (
        <LinearGradient
          colors={NEWEST_ROW_GRADIENT.colors}
          locations={NEWEST_ROW_GRADIENT.locations}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {alert.type === 'POLICE' ? (
        <PoliceLightBar orientation="vertical" width={22} height={22} />
      ) : (
        <View style={styles.rowMark}>
          <Text style={styles.rowMarkLetter}>{meta.letter}</Text>
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{meta.label.toUpperCase()}</Text>
        <Text style={[styles.rowSubtitle, highlighted ? styles.rowSubtitleHighlighted : styles.rowSubtitleNormal]}>
          {subtitle}
        </Text>
      </View>
      <Text style={styles.rowTime}>{formatLedgerTime(row.atMs, nowMs)}</Text>
    </View>
  );
}

function ReportHistoryRow({ row, nowMs, highlighted }: { row: ReportRow; nowMs: number; highlighted: boolean }) {
  const { report } = row;
  const meta = alertTypeMeta(report.category, report.subtype);
  const subtitle =
    report.headingDeg !== null
      ? `${compassDirection(report.headingDeg).toUpperCase()}BOUND · LOCATION ATTACHED`
      : 'LOCATION ATTACHED';

  return (
    <View style={styles.row}>
      {highlighted ? (
        <LinearGradient
          colors={NEWEST_ROW_GRADIENT.colors}
          locations={NEWEST_ROW_GRADIENT.locations}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {report.category === 'POLICE' ? (
        <PoliceLightBar orientation="vertical" width={22} height={22} />
      ) : (
        <View style={styles.rowMark}>
          <Text style={styles.rowMarkLetter}>{meta.letter}</Text>
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{meta.label.toUpperCase()} REPORTED</Text>
        <Text style={[styles.rowSubtitle, highlighted ? styles.rowSubtitleHighlighted : styles.rowSubtitleNormal]}>
          {subtitle}
        </Text>
      </View>
      <Text style={styles.rowTime}>{formatLedgerTime(row.atMs, nowMs)}</Text>
    </View>
  );
}

/**
 * Drag-left-to-reveal delete, for a driver's own reports only (spoken rows
 * aren't deletable - there's nothing to delete, they're just a record of
 * what was said). Built on core RN Animated/PanResponder rather than adding
 * a gesture library: this is the only swipeable control in the app so far,
 * and react-native-gesture-handler isn't a dependency here yet.
 */
function SwipeToDeleteRow({ onDelete, children }: { onDelete: () => void; children: ReactNode }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderMove: (_, gesture) => {
        const base = openRef.current ? -DELETE_REVEAL_WIDTH : 0;
        translateX.setValue(Math.min(0, Math.max(-DELETE_REVEAL_WIDTH, base + gesture.dx)));
      },
      onPanResponderRelease: (_, gesture) => {
        const base = openRef.current ? -DELETE_REVEAL_WIDTH : 0;
        const shouldOpen = base + gesture.dx < -DELETE_REVEAL_WIDTH / 2;
        openRef.current = shouldOpen;
        setIsOpen(shouldOpen);
        Animated.spring(translateX, {
          toValue: shouldOpen ? -DELETE_REVEAL_WIDTH : 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      },
    })
  ).current;

  const closeRow = useCallback(() => {
    openRef.current = false;
    setIsOpen(false);
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
  }, [translateX]);

  return (
    <View style={styles.swipeContainer}>
      <View style={styles.deleteBacking}>
        <Pressable
          onPress={onDelete}
          style={styles.deleteButton}
          accessibilityRole="button"
          accessibilityLabel="Delete this report"
        >
          <Text style={styles.deleteButtonText}>DELETE</Text>
        </Pressable>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <Pressable onPress={isOpen ? closeRow : undefined}>{children}</Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: instrument.ink,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexGrow: 0,
    flexShrink: 0,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: hud.rule,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  brandIcon: {
    width: 40,
    height: 40,
    marginRight: 4,
  },
  title: {
    fontFamily: fontFamily.black,
    fontSize: 34,
    letterSpacing: -0.5,
    color: hud.rowTitle,
  },
  headerSpacer: {
    flex: 1,
  },
  count: {
    fontFamily: fontFamily.black,
    fontSize: 24,
    color: hud.accent,
    fontVariant: ['tabular-nums'],
  },
  metaLine: {
    marginTop: 4,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: 1.5,
    color: hud.muted,
  },
  content: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    padding: 20,
  },
  emptyText: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    color: hud.rowTitle,
  },
  groupLabel: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: hud.rule,
    borderBottomWidth: 1,
    borderBottomColor: hud.rule,
  },
  groupLabelBottomOnly: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: hud.rule,
  },
  groupLabelText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 2,
    color: hud.mutedLabel,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: hud.rowRule,
  },
  rowMark: {
    width: 22,
    height: 22,
    flexGrow: 0,
    flexShrink: 0,
    borderWidth: 2,
    borderColor: hud.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMarkLetter: {
    fontFamily: fontFamily.black,
    fontSize: 12,
    color: hud.rowTitle,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily: fontFamily.black,
    fontSize: 18,
    letterSpacing: 0.5,
    color: hud.rowTitle,
  },
  rowSubtitle: {
    marginTop: 1,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  rowSubtitleNormal: {
    color: hud.rowSubMed,
  },
  rowSubtitleHighlighted: {
    color: hud.rowSubHigh,
  },
  rowTime: {
    paddingTop: 3,
    fontFamily: fontFamily.bold,
    fontSize: 12,
    letterSpacing: 1,
    color: hud.rowTitle,
    fontVariant: ['tabular-nums'],
  },
  swipeContainer: {
    overflow: 'hidden',
  },
  deleteBacking: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  deleteButton: {
    width: DELETE_REVEAL_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.policeLightRed,
  },
  deleteButtonText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    letterSpacing: 1,
    color: hud.rowTitle,
  },
});
