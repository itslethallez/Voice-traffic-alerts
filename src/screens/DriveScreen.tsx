import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ScanLine, Search, Volume2, VolumeX } from 'lucide-react-native';
import type { WazeAlert } from '../api/waze/types';
import type { SortedFacebookNotification } from '../notifications/sortFacebookNotification';
import { policeSubtypeLabel } from '../api/waze/policeSubtype';
import { AlertPill } from '../components/base/AlertPill';
import { BottomSheet, type SheetSnap } from '../components/base/BottomSheet';
import { Card } from '../components/base/Card';
import { Column, Row, Stack } from '../components/base/Layout';
import { MapOverlayPanel } from '../components/base/MapOverlayPanel';
import { ScreenContainer } from '../components/base/ScreenContainer';
import { haversineDistance } from '../geo/distance';
import type { RecentAnnouncement } from '../speech/types';
import { visibleManualReportAlerts } from '../store/manualReportAlert';
import { visibleNearbyReportAlerts } from '../store/nearbyReportAlert';
import {
  ALERT_FILTER_CATEGORIES,
  enabledTypesFromFilters,
  wazeTypeToAlertFilter,
  type AlertFilterCategory,
} from '../store/settingsDefaults';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTripStore } from '../store/useTripStore';
import { useCommunityReportStore } from '../store/useCommunityReportStore';
import { alpha, colors, radii, spacing, typography } from '../theme/tokens';
import { formatRelativeTime } from './formatRelativeTime';
import { formatCompactDistance } from './radar/formatCompactDistance';
import { NavigationStatusBar } from './radar/NavigationStatusBar';
import { RadarMap } from './radar/RadarMap';
import { ReportBar } from './radar/ReportBar';
import { Speedometer } from './radar/Speedometer';

const ANNOUNCEMENT_CARD_TIMEOUT_MS = 20_000;

/** Collapsed sheet height — deliberately just the grabber + "N alerts
 * nearby" header, no list rows. The sheet's bottom edge sits flush against
 * the app's bottom nav, so any row content in the peek would be hard-cut by
 * the nav bar (a row sliced mid-height reads as the nav sitting *inside*
 * the list). Rows exist only in the expanded state. The bottom control
 * strip's overlay offset derives from this, so the two never drift apart. */
const SHEET_PEEK_HEIGHT = 64;

/** Diameter of the floating RANGE/MUTE utility buttons — big enough for a
 * glance-free tap target, small enough to sit between the two 112 dials. */
const UTILITY_BUTTON_SIZE = 64;

const SEARCH_BUTTON_SIZE = 48;

/**
 * Sheet-row titles per normalized category (AlertPill's own labels are
 * terse category names — "Police" — while the sheet reads better with the
 * mockups' past-tense phrasing: "Police reported"). A recognized POLICE
 * subtype ("Police Visible") overrides the generic title.
 */
const ROW_TITLES: Record<AlertFilterCategory, string> = {
  police: 'Police reported',
  traffic: 'Heavy traffic',
  accident: 'Accident',
  closure: 'Road closure',
  roadkill: 'Roadkill reported',
  hazard: 'Hazard reported',
};

function rowTitle(alert: WazeAlert, filterCategory: AlertFilterCategory): string {
  if (alert.type === 'POLICE') {
    return policeSubtypeLabel(alert.subtype) ?? ROW_TITLES.police;
  }
  return ROW_TITLES[filterCategory];
}

function rowSubtitle(alert: WazeAlert, nowMs: number): string {
  const atMs = Date.parse(alert.publish_datetime_utc);
  const ago = Number.isFinite(atMs) ? formatRelativeTime(atMs, nowMs) : 'recently';
  const place = alert.street ?? (alert.city.trim() || null);
  return place ? `${place} · ${ago}` : ago;
}

interface NearbyAlertItem {
  alert: WazeAlert;
  filterCategory: AlertFilterCategory;
  /** null when there's no driver position yet — the row then omits the
   * distance rather than formatting a meaningless value. */
  distanceMeters: number | null;
}

interface DriveScreenProps {
  focusedAlert?: WazeAlert | null;
  onFocusAlert?: (alert: WazeAlert) => void;
  /** Opens the destination-search screen (App.tsx owns that overlay's
   * visibility) - omitted (button hidden) rather than a no-op default, so a
   * caller that genuinely can't offer navigation yet doesn't show a dead
   * button. */
  onOpenSearch?: () => void;
}

/** The driving view is deliberately map-first: live reports appear directly
 * on the map, reporting stays one tap away in the bottom control strip, and
 * the draggable sheet lists everything nearby, filtered by the pill row. */
export function DriveScreen({ focusedAlert = null, onFocusAlert, onOpenSearch }: DriveScreenProps) {
  const [rangeToggleToken, setRangeToggleToken] = useState(0);
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);
  const manualReports = useTripStore((state) => state.manualReports);
  const nearbyReports = useTripStore((state) => state.nearbyReports);
  const driverPosition = useTripStore((state) => state.driverPosition);
  const isOffline = useTripStore((state) => state.isOffline);
  const bannerMessage = useTripStore((state) => state.bannerMessage);
  const alertsFetchedAtMs = useTripStore((state) => state.alertsFetchedAtMs);
  const latestAnnouncement = useTripStore((state) => state.recentAnnouncements[0] ?? null);
  const categoriesEnabled = useSettingsStore((state) => state.categoriesEnabled);
  const alertTypeFilters = useSettingsStore((state) => state.alertTypeFilters);
  const toggleAlertTypeFilter = useSettingsStore((state) => state.toggleAlertTypeFilter);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);
  const masterMute = useSettingsStore((state) => state.masterMute);
  const toggleMasterMute = useSettingsStore((state) => state.toggleMasterMute);
  const communityCandidates = useCommunityReportStore((state) => state.candidates);
  const dismissCommunityCandidate = useCommunityReportStore((state) => state.dismissCandidate);
  const [now, setNow] = useState(() => Date.now());
  /** NavigationStatusBar's actually-rendered height (0 when status is
   * 'idle' and it renders nothing) - passed to RadarMap so the tapped-marker
   * detail card can clear it instead of a fixed offset tuned only for the
   * pre-nav control row (see RadarMap.tsx's alertDetailCard). */
  const [navStatusBarHeight, setNavStatusBarHeight] = useState(0);
  const latestAnnouncementKey = latestAnnouncement
    ? `${latestAnnouncement.alertId}:${latestAnnouncement.announcedAtMs}`
    : null;
  const [dismissedAnnouncementKey, setDismissedAnnouncementKey] = useState<string | null>(null);
  /** The collapsed list is a peek, not a scrollable region — scrolling is
   * enabled only once expanded, so rows can never slide under the bottom
   * nav bar that abuts the sheet's bottom edge. */
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('collapsed');

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!latestAnnouncementKey) return;

    const timeout = setTimeout(() => {
      setDismissedAnnouncementKey(latestAnnouncementKey);
    }, ANNOUNCEMENT_CARD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [latestAnnouncementKey]);

  /**
   * Everything the sheet lists, in one shape: all three sources are already
   * normalized to WazeAlert (manual/nearby reports via the store helpers,
   * which also apply the same live-window + distance bounds the map uses),
   * filtered by the same combined enabled-type set the map markers and the
   * announcer share, then sorted nearest-first.
   */
  const nearbyItems = useMemo(() => {
    const enabledTypes = enabledTypesFromFilters(categoriesEnabled, alertTypeFilters);
    const all = [
      ...visibleAlerts,
      ...visibleManualReportAlerts(manualReports, driverPosition, now, announceDistanceMeters),
      ...visibleNearbyReportAlerts(nearbyReports, driverPosition, now, announceDistanceMeters),
    ];

    const items: NearbyAlertItem[] = [];
    for (const alert of all) {
      if (!enabledTypes.has(alert.type)) continue;
      const filterCategory = wazeTypeToAlertFilter(alert.type);
      if (!filterCategory) continue;
      items.push({
        alert,
        filterCategory,
        distanceMeters: driverPosition
          ? haversineDistance(driverPosition, { latitude: alert.latitude, longitude: alert.longitude })
          : null,
      });
    }
    items.sort(
      (a, b) => (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER)
    );
    return items;
  }, [visibleAlerts, manualReports, nearbyReports, driverPosition, now, announceDistanceMeters, categoriesEnabled, alertTypeFilters]);

  const liveLabel = isOffline
    ? 'Offline'
    : alertsFetchedAtMs !== null
      ? `Live · ${formatRelativeTime(alertsFetchedAtMs, now)}`
      : 'Live';

  return (
    <ScreenContainer padded={false} edges={[]}>
      <RadarMap
        focusedAlert={focusedAlert}
        now={now}
        minimal
        rangeToggleToken={rangeToggleToken}
        navStatusBarHeight={navStatusBarHeight}
      />

      <MapOverlayPanel edge="top">
        <Stack gap="sm">
          <Row justify="space-between" align="center">
            <Image
              source={require('../../assets/shotgun-header.png')}
              style={styles.brandLogo}
              resizeMode="contain"
              accessibilityLabel="Shotgun"
            />
            {onOpenSearch ? (
              <Pressable
                onPress={onOpenSearch}
                style={styles.searchButton}
                accessibilityRole="button"
                accessibilityLabel="Search for a destination"
                accessibilityHint="Opens destination search to start turn-by-turn navigation"
              >
                <Search size={20} strokeWidth={2.2} color={colors.accent} />
              </Pressable>
            ) : null}
          </Row>

          <Row gap="xs" wrap>
            {ALERT_FILTER_CATEGORIES.map((category) => {
              const enabled = alertTypeFilters[category];
              return (
                <Pressable
                  key={category}
                  onPress={() => toggleAlertTypeFilter(category)}
                  accessibilityRole="button"
                  accessibilityState={{ checked: enabled }}
                  accessibilityLabel={`${category} alerts`}
                  accessibilityHint={
                    enabled
                      ? 'Hide this category from the map, the nearby list and announcements'
                      : 'Show this category on the map, the nearby list and announcements'
                  }
                >
                  <AlertPill type={category} size="sm" enabled={enabled} />
                </Pressable>
              );
            })}
          </Row>

          {bannerMessage ? (
            <Card variant="outlined" padding="sm">
              <Text style={styles.bannerText}>{bannerMessage}</Text>
            </Card>
          ) : null}

          {latestAnnouncement && dismissedAnnouncementKey !== latestAnnouncementKey ? (
            <ReportTicker
              announcement={latestAnnouncement}
              onPress={() => onFocusAlert?.(latestAnnouncement.candidate.alert)}
            />
          ) : null}
        </Stack>
      </MapOverlayPanel>

      <MapOverlayPanel edge="bottom" offset={SHEET_PEEK_HEIGHT + spacing.xs}>
        <Stack gap="sm">
          <View onLayout={(event) => setNavStatusBarHeight(event.nativeEvent.layout.height)}>
            <NavigationStatusBar nowMs={now} />
          </View>
          <Row justify="space-between" align="flex-end">
            <ReportBar />
            <Row gap="sm" align="flex-end">
              <Pressable
                onPress={() => setRangeToggleToken((token) => token + 1)}
                style={styles.utilityButton}
                accessibilityRole="button"
                accessibilityLabel="Toggle notification range"
                accessibilityHint="Shows or hides the configured notification range on the map"
              >
                <ScanLine size={20} strokeWidth={2.1} color={colors.accent} />
                <Text style={styles.utilityButtonLabel}>RANGE</Text>
              </Pressable>
              <Pressable
                onPress={toggleMasterMute}
                style={[styles.utilityButton, masterMute && styles.utilityButtonActive]}
                accessibilityRole="switch"
                accessibilityState={{ checked: masterMute }}
                accessibilityLabel={masterMute ? 'Unmute audio' : 'Mute audio'}
              >
                {masterMute ? (
                  <VolumeX size={20} strokeWidth={2.1} color={colors.charcoal} />
                ) : (
                  <Volume2 size={20} strokeWidth={2.1} color={colors.accent} />
                )}
                <Text style={[styles.utilityButtonLabel, masterMute && styles.utilityButtonLabelActive]}>
                  {masterMute ? 'MUTED' : 'MUTE'}
                </Text>
              </Pressable>
            </Row>
            <Speedometer />
          </Row>
        </Stack>
      </MapOverlayPanel>

      <BottomSheet
        peekHeight={SHEET_PEEK_HEIGHT}
        onSnapChange={setSheetSnap}
        header={
          <Row justify="space-between" align="center">
            <Text style={styles.sheetTitle}>
              {nearbyItems.length === 1 ? '1 alert nearby' : `${nearbyItems.length} alerts nearby`}
            </Text>
            <Text style={[styles.sheetLive, isOffline && styles.sheetLiveOffline]}>{`● ${liveLabel}`}</Text>
          </Row>
        }
      >
        <FlatList
          data={nearbyItems}
          keyExtractor={(item) => item.alert.alert_id}
          scrollEnabled={sheetSnap === 'expanded'}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
          renderItem={({ item }) => (
            <NearbyAlertRow item={item} nowMs={now} onPress={() => onFocusAlert?.(item.alert)} />
          )}
          ListEmptyComponent={
            <Text style={styles.sheetEmpty}>No enabled alerts within your range right now.</Text>
          }
          ListHeaderComponent={
            communityCandidates.length > 0 ? (
              <CommunityIntakeSection
                candidates={communityCandidates}
                onDismiss={dismissCommunityCandidate}
              />
            ) : null
          }
        />
      </BottomSheet>
    </ScreenContainer>
  );
}

function NearbyAlertRow({
  item,
  nowMs,
  onPress,
}: {
  item: NearbyAlertItem;
  nowMs: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${rowTitle(item.alert, item.filterCategory)}, ${rowSubtitle(item.alert, nowMs)}${item.distanceMeters !== null ? `, ${formatCompactDistance(item.distanceMeters)} away` : ''}. Show on map.`}
    >
      <Card variant="raised" padding="sm">
        <Row gap="sm" align="center">
          <AlertPill type={item.filterCategory} size="sm" showDot={false} />
          <Column gap="xxs" flex={1}>
            <Text style={styles.sheetRowTitle}>{rowTitle(item.alert, item.filterCategory)}</Text>
            <Text style={styles.sheetRowSub} numberOfLines={1}>
              {rowSubtitle(item.alert, nowMs)}
            </Text>
          </Column>
          {item.distanceMeters !== null ? (
            <Text style={styles.sheetRowDist}>{formatCompactDistance(item.distanceMeters)}</Text>
          ) : null}
        </Row>
      </Card>
    </Pressable>
  );
}

function ReportTicker({
  announcement,
  onPress,
}: {
  announcement: RecentAnnouncement;
  onPress: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [viewportWidth, setViewportWidth] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    if (viewportWidth <= 0 || trackWidth <= viewportWidth) {
      translateX.setValue(0);
      return;
    }

    const distance = trackWidth - viewportWidth + 28;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(700),
        Animated.timing(translateX, {
          toValue: -distance,
          duration: Math.max(7000, distance * 24),
          useNativeDriver: true,
        }),
        Animated.delay(1000),
        Animated.timing(translateX, {
          toValue: 0,
          duration: 850,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [announcement.alertId, trackWidth, translateX, viewportWidth]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`New report: ${announcement.text}. Tap to show on map`}
    >
      <Card variant="raised" padding="sm" style={styles.tickerCard}>
        <Row align="center" gap="sm">
          <View
            style={styles.tickerViewport}
            onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
          >
            <Animated.View
              style={[styles.tickerTrack, { transform: [{ translateX }] }]}
              onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
            >
              <Text style={styles.tickerText} numberOfLines={1}>
                <Text style={styles.tickerLead}>LIVE REPORT</Text>
                {'  •  '}
                {announcement.text}
                {'  •  TAP TO SHOW ON MAP'}
              </Text>
            </Animated.View>
          </View>
          <View style={styles.tickerTag}>
            <Text style={styles.tickerTagText}>MAP</Text>
          </View>
        </Row>
      </Card>
    </Pressable>
  );
}

/**
 * The human-review queue for Facebook-derived notices — migrated from the
 * retired ReportsScreen, where it was the only functionality not already
 * covered by the map popup + this sheet. Candidates stay unverified until
 * reviewed; dismiss drops them from the pending list.
 */
function CommunityIntakeSection({
  candidates,
  onDismiss,
}: {
  candidates: SortedFacebookNotification[];
  onDismiss: (sourceRef: string) => void;
}) {
  return (
    <Card variant="outlined" padding="sm" style={styles.intakeCard}>
      <Stack gap="xs">
        <Row justify="space-between" align="baseline">
          <Text style={styles.intakeHeading}>COMMUNITY INTAKE</Text>
          <Text style={styles.intakeCount}>{candidates.length} PENDING</Text>
        </Row>
        <Text style={styles.intakeIntro}>
          Facebook notices are unverified. Review before they can become live map or voice alerts.
        </Text>
        {candidates.map((candidate) => (
          <Pressable
            key={candidate.sourceRef}
            onPress={() => onDismiss(candidate.sourceRef)}
            style={styles.intakeRow}
            accessibilityRole="button"
            accessibilityLabel={`${candidate.summary}. ${candidate.decision === 'eligible' ? 'Ready for location check' : 'Review required'}. Dismiss.`}
          >
            <Column gap="xxs" flex={1}>
              <Text style={styles.intakeSummary}>{candidate.summary}</Text>
              <Text style={styles.intakeMeta}>
                {candidate.decision === 'eligible' ? 'READY FOR LOCATION CHECK' : 'REVIEW REQUIRED'}
                {' · '}{Math.round(candidate.confidence * 100)}% CONFIDENCE · UNVERIFIED
              </Text>
            </Column>
            <Text style={styles.intakeDismiss}>DISMISS</Text>
          </Pressable>
        ))}
      </Stack>
    </Card>
  );
}

const styles = StyleSheet.create({
  brandLogo: {
    // 1222x312 crop of the brand-board lockup - aspectRatio alone collapses
    // on web (img falls back to natural width), so both axes are explicit.
    width: 172,
    height: 44,
  },
  searchButton: {
    width: SEARCH_BUTTON_SIZE,
    height: SEARCH_BUTTON_SIZE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: alpha(colors.teal, 0.4),
  },
  bannerText: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: typography.fontSize.caption,
    color: colors.caution,
  },
  tickerCard: {
    borderWidth: 1,
    borderColor: alpha(colors.teal, 0.5),
  },
  tickerViewport: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  tickerTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  tickerText: {
    fontFamily: typography.fontFamily.bodySemibold,
    fontSize: typography.fontSize.caption,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textPrimary,
  },
  tickerLead: {
    color: colors.accent,
  },
  tickerTag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
  },
  tickerTagText: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.charcoal,
  },
  utilityButton: {
    width: UTILITY_BUTTON_SIZE,
    height: UTILITY_BUTTON_SIZE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  utilityButtonActive: {
    backgroundColor: colors.accent,
  },
  utilityButtonLabel: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.accent,
  },
  utilityButtonLabelActive: {
    color: colors.charcoal,
  },
  sheetTitle: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.title,
    color: colors.textPrimary,
  },
  sheetLive: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.accent,
  },
  sheetLiveOffline: {
    color: colors.critical,
  },
  sheetEmpty: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.body,
    color: colors.textSecondary,
  },
  sheetRowTitle: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.body,
    color: colors.textPrimary,
  },
  sheetRowSub: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textSecondary,
  },
  sheetRowDist: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.bodyLarge,
    color: colors.textPrimary,
  },
  rowSeparator: {
    height: spacing.sm,
  },
  intakeCard: {
    marginBottom: spacing.sm,
    borderColor: alpha(colors.caution, 0.4),
  },
  intakeHeading: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.caption,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.caution,
  },
  intakeCount: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.caution,
  },
  intakeIntro: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textSecondary,
  },
  intakeRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  intakeSummary: {
    fontFamily: typography.fontFamily.bodySemibold,
    fontSize: typography.fontSize.body,
    color: colors.textPrimary,
  },
  intakeMeta: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.caution,
  },
  intakeDismiss: {
    minHeight: 44,
    paddingHorizontal: spacing.xs,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textMuted,
  },
});
