import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ScanLine, Volume2, VolumeX } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { WazeAlert } from '../api/waze/types';
import type { RecentAnnouncement } from '../speech/types';
import { useIsLandscape } from '../hooks/useIsLandscape';
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
  const isLandscape = useIsLandscape();
  const { width: viewportWidth } = useWindowDimensions();
  const compactControls = !isLandscape && viewportWidth < 430;
  const [rangeToggleToken, setRangeToggleToken] = useState(0);
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);
  const manualReports = useTripStore((state) => state.manualReports);
  const nearbyReports = useTripStore((state) => state.nearbyReports);
  const driverPosition = useTripStore((state) => state.driverPosition);
  const locationError = useTripStore((state) => state.locationError);
  const isOffline = useTripStore((state) => state.isOffline);
  const latestAnnouncement = useTripStore((state) => state.recentAnnouncements[0] ?? null);
  const categoriesEnabled = useSettingsStore((state) => state.categoriesEnabled);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);
  const masterMute = useSettingsStore((state) => state.masterMute);
  const toggleMasterMute = useSettingsStore((state) => state.toggleMasterMute);
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
      <RadarMap focusedAlert={focusedAlert} now={now} minimal rangeToggleToken={rangeToggleToken} />

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View style={[styles.topBar, isLandscape && styles.topBarLandscape]}>
          <View style={styles.brandBlock}>
            <Image
              source={require('../../assets/shotgun-header.png')}
              style={[styles.brandLogo, isLandscape && styles.brandLogoLandscape]}
              resizeMode="contain"
              accessibilityLabel="Shotgun"
            />
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
          {latestAnnouncement && dismissedAnnouncementKey !== latestAnnouncementKey ? (
            <ReportTicker
              announcement={latestAnnouncement}
              onPress={() => onFocusAlert?.(latestAnnouncement.candidate.alert)}
            />
          ) : (
            <View style={styles.tickerPlaceholder} />
          )}
          <View style={styles.bottomStack}>
            <View style={[styles.controlRow, isLandscape && styles.controlRowLandscape, compactControls && styles.controlRowCompact]}>
              <ReportBar />
              <Pressable
                onPress={() => setRangeToggleToken((token) => token + 1)}
                style={[styles.utilityButton, compactControls && styles.utilityButtonCompact]}
                accessibilityRole="button"
                accessibilityLabel="Toggle notification range"
                accessibilityHint="Shows or hides the configured notification range on the map"
              >
                <ScanLine size={compactControls ? 18 : 22} strokeWidth={2.1} color={hud.accent} />
                <Text style={styles.utilityButtonLabel}>RANGE</Text>
              </Pressable>
              <Pressable
                onPress={toggleMasterMute}
                style={[styles.utilityButton, masterMute && styles.utilityButtonActive, compactControls && styles.utilityButtonCompact]}
                accessibilityRole="switch"
                accessibilityState={{ checked: masterMute }}
                accessibilityLabel={masterMute ? 'Unmute audio' : 'Mute audio'}
              >
                {masterMute ? (
                  <VolumeX size={compactControls ? 18 : 22} strokeWidth={2.1} color="#062128" />
                ) : (
                  <Volume2 size={compactControls ? 18 : 22} strokeWidth={2.1} color={hud.accent} />
                )}
                <Text style={[styles.utilityButtonLabel, masterMute && styles.utilityButtonLabelActive]}>
                  {masterMute ? 'MUTED' : 'MUTE'}
                </Text>
              </Pressable>
              <Speedometer />
            </View>
          </View>
        </View>
      </SafeAreaView>
    </View>
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
      style={styles.tickerBanner}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`New report: ${announcement.text}. Tap to show on map`}
    >
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
    </Pressable>
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
    backgroundColor: hud.ground,
    paddingBottom: 8,
  },
  topBarLandscape: {
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 4,
  },
  brandBlock: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandLogo: {
    width: 168,
    height: 56,
  },
  brandLogoLandscape: {
    width: 140,
    height: 46,
  },
  livePill: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 24,
    backgroundColor: hud.ground,
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
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  tickerPlaceholder: {
    height: 48,
    marginHorizontal: 16,
  },
  tickerBanner: {
    height: 48,
    marginHorizontal: 16,
    paddingLeft: 14,
    paddingRight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: hud.ground,
    borderWidth: 1,
    borderColor: 'rgba(76, 191, 169, 0.7)',
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
    fontFamily: fontFamily.bold,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.65,
    color: hud.rowTitle,
  },
  tickerLead: {
    color: hud.accent,
  },
  tickerTag: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: hud.accent,
  },
  tickerTagText: {
    fontFamily: fontFamily.black,
    fontSize: 9,
    letterSpacing: 1,
    color: '#062128',
  },
  bottomStack: {
    gap: 10,
    paddingBottom: 14,
  },
  controlRow: {
    marginHorizontal: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  controlRowCompact: {
    marginHorizontal: 6,
  },
  controlRowLandscape: {
    marginHorizontal: 28,
  },
  utilityButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: hud.ground,
    borderWidth: 2,
    borderColor: hud.accent,
  },
  utilityButtonCompact: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  utilityButtonActive: {
    backgroundColor: hud.accent,
    borderColor: hud.accentBright,
  },
  utilityButtonLabel: {
    fontFamily: fontFamily.black,
    fontSize: 9,
    letterSpacing: 0.8,
    color: hud.accent,
  },
  utilityButtonLabelActive: {
    color: '#062128',
  },
});
