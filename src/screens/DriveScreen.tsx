import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { WazeAlert } from '../api/waze/types';
import { visibleManualReportAlerts } from '../store/manualReportAlert';
import { visibleNearbyReportAlerts } from '../store/nearbyReportAlert';
import { enabledTypesFromSettings } from '../store/settingsDefaults';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTripStore } from '../store/useTripStore';
import { hud } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { RadarMap } from './radar/RadarMap';
import { ReportBar } from './radar/ReportBar';
import { Speedometer } from './radar/Speedometer';

const ANNOUNCEMENT_CARD_TIMEOUT_MS = 20_000;

interface DriveScreenProps {
  focusedAlert?: WazeAlert | null;
  onFocusAlert?: (alert: WazeAlert) => void;
}

/** The driving view is deliberately map-first: live reports appear directly
 * on the map, while reporting stays one tap away in the floating bottom dock. */
export function DriveScreen({ focusedAlert = null, onFocusAlert }: DriveScreenProps) {
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);
  const manualReports = useTripStore((state) => state.manualReports);
  const nearbyReports = useTripStore((state) => state.nearbyReports);
  const driverPosition = useTripStore((state) => state.driverPosition);
  const locationError = useTripStore((state) => state.locationError);
  const isOffline = useTripStore((state) => state.isOffline);
  const latestAnnouncement = useTripStore((state) => state.recentAnnouncements[0] ?? null);
  const categoriesEnabled = useSettingsStore((state) => state.categoriesEnabled);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);
  const [now, setNow] = useState(() => Date.now());
  const latestAnnouncementKey = latestAnnouncement
    ? `${latestAnnouncement.alertId}:${latestAnnouncement.announcedAtMs}`
    : null;
  const [dismissedAnnouncementKey, setDismissedAnnouncementKey] = useState<string | null>(null);

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

  const liveReportCount = useMemo(() => {
    const enabledTypes = enabledTypesFromSettings(categoriesEnabled);
    const wazeCount = visibleAlerts.filter((alert) => enabledTypes.has(alert.type)).length;
    const ownCount = visibleManualReportAlerts(manualReports, driverPosition, now, announceDistanceMeters).filter(
      (alert) => enabledTypes.has(alert.type)
    ).length;
    const nearbyCount = visibleNearbyReportAlerts(nearbyReports, driverPosition, now, announceDistanceMeters).filter(
      (alert) => enabledTypes.has(alert.type)
    ).length;
    return wazeCount + ownCount + nearbyCount;
  }, [visibleAlerts, manualReports, nearbyReports, driverPosition, now, announceDistanceMeters, categoriesEnabled]);

  const locationLabel = locationError
    ? 'LOCATION UNAVAILABLE'
    : driverPosition
      ? 'CURRENT LOCATION'
      : 'LOCATING';

  return (
    <View style={styles.root}>
      <RadarMap focusedAlert={focusedAlert} now={now} minimal />

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.topBar}>
          <View style={styles.brandBlock}>
            <Image source={require('../../assets/streetwise-icon.png')} style={styles.brandIcon} resizeMode="contain" />
            <View style={styles.brandCopy}>
              <Text style={styles.brandTitle} numberOfLines={1}>STREETWISE</Text>
              <Text style={styles.brandSubtitle}>LIVE MAP</Text>
            </View>
          </View>
          <View style={styles.livePill} accessible accessibilityLabel={`${liveReportCount} live reports, ${locationLabel.toLowerCase()}`}>
            <View style={[styles.liveDot, isOffline && styles.offlineDot]} />
            <View>
              <Text style={styles.liveCount}>{liveReportCount} LIVE REPORTS</Text>
              <Text style={styles.locationLabel}>{isOffline ? 'OFFLINE' : locationLabel}</Text>
            </View>
          </View>
        </View>

        <View pointerEvents="box-none" style={styles.mapChrome}>
          <View style={styles.bottomStack}>
            {latestAnnouncement && dismissedAnnouncementKey !== latestAnnouncementKey ? (
              <View style={styles.announcementCard} accessibilityLiveRegion="polite">
                <View style={styles.announcementCopy}>
                  <Text style={styles.announcementEyebrow}>JUST ANNOUNCED</Text>
                  <Text style={styles.announcementText} numberOfLines={3}>{latestAnnouncement.text}</Text>
                </View>
                <Pressable
                  onPress={() => onFocusAlert?.(latestAnnouncement.candidate.alert)}
                  style={styles.showOnMapButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Show announced report on map: ${latestAnnouncement.text}`}
                >
                  <Text style={styles.showOnMapText}>SHOW ON MAP</Text>
                </Pressable>
                <Pressable
                  onPress={() => setDismissedAnnouncementKey(latestAnnouncementKey)}
                  style={styles.dismissButton}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss announced report"
                >
                  <Text style={styles.dismissText}>×</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.reportDock}>
              <Speedometer />
              <ReportBar />
            </View>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: hud.mapGround,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  brandBlock: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandIcon: {
    width: 42,
    height: 42,
  },
  brandCopy: {
    flexShrink: 1,
  },
  brandTitle: {
    fontFamily: fontFamily.black,
    fontSize: 18,
    letterSpacing: 0.4,
    color: hud.rowTitle,
  },
  brandSubtitle: {
    marginTop: 2,
    fontFamily: fontFamily.bold,
    fontSize: 9,
    letterSpacing: 1.4,
    color: hud.accent,
  },
  livePill: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 24,
    backgroundColor: 'rgba(6, 27, 31, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(76, 191, 169, 0.48)',
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: hud.accent,
  },
  offlineDot: {
    backgroundColor: hud.muted,
  },
  liveCount: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 0.8,
    color: hud.rowTitle,
  },
  locationLabel: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 9,
    letterSpacing: 1.1,
    color: hud.accent,
  },
  mapChrome: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'flex-end',
    paddingTop: 12,
  },
  bottomStack: {
    gap: 10,
    paddingBottom: 14,
  },
  announcementCard: {
    minHeight: 82,
    marginHorizontal: 16,
    padding: 14,
    paddingRight: 52,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.97)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 9,
  },
  announcementCopy: {
    flex: 1,
    minWidth: 0,
  },
  announcementEyebrow: {
    fontFamily: fontFamily.bold,
    fontSize: 9,
    letterSpacing: 1.4,
    color: '#087566',
  },
  announcementText: {
    marginTop: 4,
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    color: '#07313C',
  },
  showOnMapButton: {
    minWidth: 94,
    minHeight: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: hud.accent,
  },
  showOnMapText: {
    fontFamily: fontFamily.bold,
    fontSize: 9,
    letterSpacing: 0.8,
    color: '#062128',
  },
  dismissButton: {
    position: 'absolute',
    right: 4,
    top: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontFamily: fontFamily.medium,
    fontSize: 22,
    lineHeight: 24,
    color: '#587177',
  },
  reportDock: {
    marginHorizontal: 16,
    overflow: 'hidden',
    borderRadius: 22,
    backgroundColor: 'rgba(6, 20, 24, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(150, 210, 204, 0.28)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
    elevation: 8,
  },
});
