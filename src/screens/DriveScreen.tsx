import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search } from 'lucide-react-native';
import type { WazeAlert } from '../api/waze/types';
import type { SortedFacebookNotification } from '../notifications/sortFacebookNotification';
import { policeSubtypeLabel } from '../api/waze/policeSubtype';
import { AlertPill } from '../components/base/AlertPill';
import { BottomSheet, type SheetSnap } from '../components/base/BottomSheet';
import { Card } from '../components/base/Card';
import { Column, Row, Stack } from '../components/base/Layout';
import { MapOverlayPanel } from '../components/base/MapOverlayPanel';
import { ScreenContainer } from '../components/base/ScreenContainer';
import { startPerfMonitor, stopPerfMonitor } from '../diagnostics/frameRate';
import { haversineDistance } from '../geo/distance';
import { visibleManualReportAlerts } from '../store/manualReportAlert';
import { visibleNearbyReportAlerts } from '../store/nearbyReportAlert';
import {
  ALERT_FILTER_CATEGORIES,
  visibleTypesFromFilters,
  wazeTypeToAlertFilter,
  type AlertFilterCategory,
} from '../store/settingsDefaults';
import { useSettingsStore } from '../store/useSettingsStore';
import { maxAlertDistanceMeters } from '../engine/alertDistance';
import { useTripStore } from '../store/useTripStore';
import { useCommunityReportStore } from '../store/useCommunityReportStore';
import { useNavigationStore } from '../store/useNavigationStore';
import { NAVIGATE_MODE_ENABLED } from '../config/featureFlags';
import { useRouteOptionsStore } from '../store/useRouteOptionsStore';
import { alpha, colors, radii, shadows, sizes, spacing, typography } from '../theme/tokens';
import { formatRelativeTime } from './formatRelativeTime';
import { AheadRow } from './cruise/AheadRow';
import { alertSourceLabel } from './cruise/alertVisual';
import { CruiseStatusPill, type FeedState } from './cruise/CruiseStatusPill';
import { LiveAlertCard } from './cruise/LiveAlertCard';
import { ManeuverBanner } from './radar/ManeuverBanner';
import { NavigationStatusBar } from './radar/NavigationStatusBar';
import { RadarMap } from './radar/RadarMap';
import { ReportBar } from './radar/ReportBar';
import { RouteOptionsPanel } from './radar/RouteOptionsPanel';

const ANNOUNCEMENT_CARD_TIMEOUT_MS = 20_000;

/** The feed polls every 15-30s; no successful fetch for this long is
 * disclosed as "not updating" (CLAUDE.md: silence never reads as clear). */
const FEED_STALE_AFTER_MS = 3 * 60_000;

/** Rows visible in the collapsed sheet - the mockup's peek shows the two
 * nearest things, never a row sliced at the edge. */
const PEEK_ROWS = 2;

/** One line of 18px heading text, rounded up. */
const SHEET_HEADER_LINE = typography.fontSize.sheetTitle + spacing.xs;

/** Collapsed sheet height, built from the same tokens the sheet and rows
 * use so the peek always ends exactly under the last peek row/button. */
function sheetPeekHeight(withDestinationButton: boolean): number {
  const handleZone = spacing.compact + sizes.grabberHeight + spacing.sm + SHEET_HEADER_LINE;
  const rows = PEEK_ROWS * sizes.tileSm + (PEEK_ROWS - 1) * spacing.compact;
  const button = withDestinationButton ? spacing.sm + sizes.chrome : 0;
  return handleZone + spacing.sm + rows + button + spacing.lg;
}

/**
 * Sheet-row titles per normalized category - past tense for crowd reports,
 * plain fact for scheduled cameras (same phrasing the voice uses). A
 * recognized POLICE subtype ("Police Visible") overrides the generic title.
 */
const ROW_TITLES: Record<AlertFilterCategory, string> = {
  police: 'Police',
  mobile_camera: 'Mobile camera',
  fixed_camera: 'Speed camera',
  traffic: 'Heavy traffic',
  accident: 'Crash',
  closure: 'Road closed',
  roadkill: 'Animal on road',
  hazard: 'Hazard',
};

function alertPlace(alert: WazeAlert): string | null {
  return alert.street ?? (alert.city.trim() || null);
}

function rowTitle(alert: WazeAlert, filterCategory: AlertFilterCategory): string {
  const kind = alert.type === 'POLICE' ? (policeSubtypeLabel(alert.subtype) ?? ROW_TITLES.police) : ROW_TITLES[filterCategory];
  const place = alertPlace(alert);
  return place ? `${kind} · ${place}` : kind;
}

function alertAge(alert: WazeAlert, nowMs: number): string {
  const atMs = Date.parse(alert.publish_datetime_utc);
  return Number.isFinite(atMs) ? formatRelativeTime(atMs, nowMs) : 'recently';
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
  /** Opens the destination flow (App.tsx owns that overlay) - omitted
   * (button hidden) rather than a no-op, so a build that can't offer it
   * yet shows no dead button. */
  onOpenSearch?: () => void;
  /** Opens settings - the status pill's gear. */
  onOpenSettings?: () => void;
}

/**
 * Cruise (Stage 8, mockup board 1): the map owns the screen. One status
 * pill on top, the speed roundel on the map's left edge (RadarMap), the
 * report button bottom-right, and the "Ahead of you" sheet. When Shotgun
 * speaks, the live alert card (board 2) takes the top of the screen.
 */
export function DriveScreen({ focusedAlert = null, onFocusAlert, onOpenSearch, onOpenSettings }: DriveScreenProps) {
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);
  const manualReports = useTripStore((state) => state.manualReports);
  const nearbyReports = useTripStore((state) => state.nearbyReports);
  const confirmNearbyReport = useTripStore((state) => state.confirmNearbyReport);
  const driverPosition = useTripStore((state) => state.driverPosition);
  const isOffline = useTripStore((state) => state.isOffline);
  const bannerMessage = useTripStore((state) => state.bannerMessage);
  const alertsFetchedAtMs = useTripStore((state) => state.alertsFetchedAtMs);
  const latestAnnouncement = useTripStore((state) => state.recentAnnouncements[0] ?? null);
  const alertTypeFilters = useSettingsStore((state) => state.alertTypeFilters);
  const toggleAlertTypeFilter = useSettingsStore((state) => state.toggleAlertTypeFilter);
  const masterMute = useSettingsStore((state) => state.masterMute);
  const toggleMasterMute = useSettingsStore((state) => state.toggleMasterMute);
  const announceDistanceMeters = useSettingsStore((state) => maxAlertDistanceMeters(state.alertDistance));
  const communityCandidates = useCommunityReportStore((state) => state.candidates);
  const dismissCommunityCandidate = useCommunityReportStore((state) => state.dismissCandidate);
  /** Route-planning state - anything but 'idle' means the options panel
   * replaces the sheet/report bar until the plan is picked or cancelled. */
  const routeOptionsActive = useRouteOptionsStore((state) => state.status !== 'idle') && NAVIGATE_MODE_ENABLED;
  const navigationStatus = useNavigationStore((state) => state.status);
  const activeRoute = useNavigationStore((state) => state.activeRoute);
  const navCurrentStepIndex = useNavigationStore((state) => state.currentStepIndex);
  const navDistanceToNextManeuverM = useNavigationStore((state) => state.distanceToNextManeuverM);
  const isNavigating =
    NAVIGATE_MODE_ENABLED && (navigationStatus === 'navigating' || navigationStatus === 'rerouting');
  const insets = useSafeAreaInsets();
  /** Measured height of the top overlay chrome - passed to RadarMap so its
   * own overlays start below it. */
  const [topChromeHeight, setTopChromeHeight] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [navStatusBarHeight, setNavStatusBarHeight] = useState(0);
  const latestAnnouncementKey = latestAnnouncement
    ? `${latestAnnouncement.alertId}:${latestAnnouncement.announcedAtMs}`
    : null;
  const [dismissedAnnouncementKey, setDismissedAnnouncementKey] = useState<string | null>(null);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('collapsed');

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // JS-thread fps + event-loop lag sampler for real-device drive tests.
  useEffect(() => {
    startPerfMonitor();
    return () => stopPerfMonitor();
  }, []);

  useEffect(() => {
    if (!latestAnnouncementKey) return;
    const timeout = setTimeout(() => {
      setDismissedAnnouncementKey(latestAnnouncementKey);
    }, ANNOUNCEMENT_CARD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [latestAnnouncementKey]);

  /**
   * Everything the sheet lists, in one shape: all three sources normalized
   * to WazeAlert, filtered by the same visible-type set the map markers
   * use, then sorted nearest-first.
   */
  const nearbyItems = useMemo(() => {
    const enabledTypes = visibleTypesFromFilters(alertTypeFilters);
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
  }, [visibleAlerts, manualReports, nearbyReports, driverPosition, now, announceDistanceMeters, alertTypeFilters]);

  const feedState: FeedState = isOffline
    ? 'offline'
    : alertsFetchedAtMs !== null && now - alertsFetchedAtMs > FEED_STALE_AFTER_MS
      ? 'stale'
      : 'live';

  const liveCard = useMemo(() => {
    if (!latestAnnouncement || dismissedAnnouncementKey === latestAnnouncementKey) return null;
    const alert = latestAnnouncement.candidate.alert;
    const category = wazeTypeToAlertFilter(alert.type);
    if (!category) return null;
    const nearby = nearbyReports.find((report) => report.id === alert.alert_id) ?? null;
    const place = alertPlace(alert);
    return {
      alert,
      category,
      text: latestAnnouncement.text,
      detail: place ? `${place} · ${alertAge(alert, now)}` : alertAge(alert, now),
      announcedDistanceMeters: latestAnnouncement.candidate.distanceMeters,
      nearby,
    };
  }, [latestAnnouncement, latestAnnouncementKey, dismissedAnnouncementKey, nearbyReports, now]);

  const showDestinationButton = Boolean(onOpenSearch);
  const peekHeight = sheetPeekHeight(showDestinationButton);
  const thingsLabel = nearbyItems.length === 1 ? '1 thing' : `${nearbyItems.length} things`;

  const renderRow = (item: NearbyAlertItem) => (
    <AheadRow
      alert={item.alert}
      category={item.filterCategory}
      title={rowTitle(item.alert, item.filterCategory)}
      subtitle={`${alertAge(item.alert, now)} · ${alertSourceLabel(item.alert, item.filterCategory)}`}
      distanceMeters={item.distanceMeters}
      onPress={() => onFocusAlert?.(item.alert)}
    />
  );

  const destinationButton = showDestinationButton ? (
    <Pressable
      onPress={onOpenSearch}
      style={styles.destinationButton}
      accessibilityRole="button"
      accessibilityLabel="Going somewhere? Add a destination"
    >
      <Search size={18} strokeWidth={2.2} color={colors.textPrimary} />
      <Text style={styles.destinationLabel}>Going somewhere? Add a destination</Text>
    </Pressable>
  ) : null;

  const emptyText =
    feedState === 'offline'
      ? "Offline - can't check what's ahead right now."
      : feedState === 'stale'
        ? "Alerts aren't updating - this list may be out of date."
        : 'Nothing reported in your range right now.';

  return (
    <ScreenContainer padded={false} edges={[]}>
      <RadarMap
        focusedAlert={focusedAlert}
        now={now}
        minimal
        navStatusBarHeight={navStatusBarHeight}
        topOverlayBottom={insets.top + topChromeHeight}
      />

      <MapOverlayPanel edge="top" offset={spacing.compact}>
        <View onLayout={(event) => setTopChromeHeight(event.nativeEvent.layout.height)}>
          <Stack gap="sm">
            {isNavigating && activeRoute ? (
              <ManeuverBanner
                instruction={
                  activeRoute.steps[navCurrentStepIndex + 1]?.maneuver.instruction ?? 'Arriving at destination'
                }
                distanceMeters={navDistanceToNextManeuverM}
                nextInstruction={activeRoute.steps[navCurrentStepIndex + 2]?.maneuver.instruction ?? null}
                maneuverType={activeRoute.steps[navCurrentStepIndex + 1]?.maneuver.type}
                maneuverModifier={activeRoute.steps[navCurrentStepIndex + 1]?.maneuver.modifier}
              />
            ) : liveCard ? null : (
              <CruiseStatusPill
                feedState={feedState}
                watchingKm={announceDistanceMeters / 1000}
                lastUpdateLabel={alertsFetchedAtMs !== null ? formatRelativeTime(alertsFetchedAtMs, now) : null}
                muted={masterMute}
                onToggleMute={toggleMasterMute}
                onOpenSettings={onOpenSettings}
              />
            )}

            {liveCard ? (
              <LiveAlertCard
                alert={liveCard.alert}
                category={liveCard.category}
                spokenText={liveCard.text}
                detail={liveCard.detail}
                distanceMeters={
                  driverPosition
                    ? haversineDistance(driverPosition, {
                        latitude: liveCard.alert.latitude,
                        longitude: liveCard.alert.longitude,
                      })
                    : null
                }
                announcedDistanceMeters={liveCard.announcedDistanceMeters}
                canConfirm={liveCard.nearby !== null}
                confirmed={liveCard.nearby?.confirmedByThisDevice ?? false}
                onConfirm={() => confirmNearbyReport(liveCard.alert.alert_id)}
                onDismiss={() => setDismissedAnnouncementKey(latestAnnouncementKey)}
                onShowOnMap={() => onFocusAlert?.(liveCard.alert)}
              />
            ) : null}

            {bannerMessage ? (
              <View style={styles.banner} accessibilityLiveRegion="polite">
                <Text style={styles.bannerText}>{bannerMessage}</Text>
              </View>
            ) : null}
          </Stack>
        </View>
      </MapOverlayPanel>

      {routeOptionsActive ? (
        <MapOverlayPanel edge="bottom" scrim>
          <RouteOptionsPanel />
        </MapOverlayPanel>
      ) : (
        <>
          <MapOverlayPanel edge="bottom" offset={peekHeight + spacing.sm}>
            <Stack gap="sm">
              <Row justify="flex-end" align="flex-end">
                <ReportBar />
              </Row>
              {NAVIGATE_MODE_ENABLED ? (
                <View onLayout={(event) => setNavStatusBarHeight(event.nativeEvent.layout.height)}>
                  <NavigationStatusBar nowMs={now} />
                </View>
              ) : null}
            </Stack>
          </MapOverlayPanel>

          <BottomSheet
            peekHeight={peekHeight}
            onSnapChange={setSheetSnap}
            header={
              <Row justify="space-between" align="baseline">
                <Text style={styles.sheetTitle}>Ahead of you</Text>
                <Text style={styles.sheetCount}>{thingsLabel}</Text>
              </Row>
            }
          >
            {sheetSnap === 'expanded' ? (
              <FlatList
                data={nearbyItems}
                keyExtractor={(item) => item.alert.alert_id}
                showsVerticalScrollIndicator={false}
                ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
                renderItem={({ item }) => renderRow(item)}
                ListEmptyComponent={<Text style={styles.sheetEmpty}>{emptyText}</Text>}
                ListHeaderComponent={
                  <Stack gap="sm" style={styles.listHeader}>
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
                                ? 'Hide this category from the map, this list and announcements'
                                : 'Show this category on the map, this list and announcements'
                            }
                          >
                            <AlertPill type={category} size="sm" enabled={enabled} />
                          </Pressable>
                        );
                      })}
                    </Row>
                    {communityCandidates.length > 0 ? (
                      <CommunityIntakeSection candidates={communityCandidates} onDismiss={dismissCommunityCandidate} />
                    ) : null}
                  </Stack>
                }
                ListFooterComponent={destinationButton ? <View style={styles.listFooter}>{destinationButton}</View> : null}
              />
            ) : (
              <Stack gap="sm">
                <Stack gap="compact">
                  {nearbyItems.length > 0 ? (
                    nearbyItems.slice(0, PEEK_ROWS).map((item) => <View key={item.alert.alert_id}>{renderRow(item)}</View>)
                  ) : (
                    <Text style={styles.sheetEmpty}>{emptyText}</Text>
                  )}
                </Stack>
                {destinationButton}
              </Stack>
            )}
          </BottomSheet>
        </>
      )}
    </ScreenContainer>
  );
}

/**
 * The human-review queue for Facebook-derived notices. Candidates stay
 * unverified until reviewed; dismiss drops them from the pending list.
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
          <Text style={styles.intakeHeading}>Community intake</Text>
          <Text style={styles.intakeCount}>{candidates.length} pending</Text>
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
                {candidate.decision === 'eligible' ? 'Ready for location check' : 'Review required'}
                {' · '}
                {Math.round(candidate.confidence * 100)}% confidence · unverified
              </Text>
            </Column>
            <Text style={styles.intakeDismiss}>Dismiss</Text>
          </Pressable>
        ))}
      </Stack>
    </Card>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: alpha(colors.caution, 0.4),
    ...shadows.chrome,
  },
  bannerText: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: typography.fontSize.meta,
    color: colors.caution,
  },
  sheetTitle: {
    fontFamily: typography.fontFamily.heavy,
    fontSize: typography.fontSize.sheetTitle,
    color: colors.textPrimary,
  },
  sheetCount: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textSecondary,
  },
  sheetEmpty: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.label,
    color: colors.textSecondary,
  },
  rowSeparator: {
    height: spacing.compact,
  },
  listHeader: {
    paddingBottom: spacing.sm,
  },
  listFooter: {
    paddingTop: spacing.md,
  },
  destinationButton: {
    height: sizes.chrome,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceControl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.compact,
  },
  destinationLabel: {
    fontFamily: typography.fontFamily.bodyBold,
    fontSize: typography.fontSize.body,
    color: colors.textPrimary,
  },
  intakeCard: {
    borderColor: alpha(colors.caution, 0.4),
  },
  intakeHeading: {
    fontFamily: typography.fontFamily.bodyBold,
    fontSize: typography.fontSize.caption,
    color: colors.caution,
  },
  intakeCount: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: typography.fontSize.eyebrow,
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
    fontSize: typography.fontSize.label,
    color: colors.textPrimary,
  },
  intakeMeta: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: typography.fontSize.eyebrow,
    color: colors.caution,
  },
  intakeDismiss: {
    minHeight: 44,
    paddingHorizontal: spacing.xs,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontFamily: typography.fontFamily.bodyBold,
    fontSize: typography.fontSize.caption,
    color: colors.textMuted,
  },
});
