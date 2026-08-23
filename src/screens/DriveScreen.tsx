import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { WazeAlert } from '../api/waze/types';
import { selectNearbyAlerts } from '../engine/selectNearbyAlerts';
import { statusFor, statusLabel, useTripStore } from '../store/useTripStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { NearbyAlertsSlider } from './radar/NearbyAlertsSlider';
import { NearbyTransmissionCard } from './radar/NearbyTransmissionCard';
import { RadarMap } from './radar/RadarMap';
import { ReportButton } from './radar/ReportButton';
import { Speedometer } from './radar/Speedometer';

/** How long a tapped nearby-alert card keeps the map focused on it before
 * the camera returns to following the driver (Step 12 #25). */
const ALERT_FOCUS_DURATION_MS = 5000;

const brandBadgeImage = require('../../assets/brand-badge.png');

/** Dot colour for the header's status line - lime for "actively
 * listening" (matches the report button's accent, reads as "go"), amber for
 * offline (a real degraded-mode warning), faint for muted (intentional,
 * not a problem). */
const STATUS_DOT_COLOR: Record<ReturnType<typeof statusFor>, string> = {
  listening: colors.report,
  offline: colors.warning,
  muted: colors.inkFaint,
};

const SLIDESHOW_INTERVAL_MS = 2000;

/**
 * Cycles through the on-screen card for each recent announcement, 2s
 * apiece, rather than only ever showing the latest one. Snaps straight
 * back to index 0 (the newest) whenever a fresh announcement arrives -
 * keyed on its announcedAtMs, since alertId alone can repeat for a
 * proximity-reminder re-announcement - so the slideshow never lingers on
 * a stale item while a brand new one is waiting to be seen.
 */
function useAnnouncementSlideIndex(count: number, latestAnnouncedAtMs: number | null): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [latestAnnouncedAtMs]);

  useEffect(() => {
    if (count <= 1) return undefined;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, SLIDESHOW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [count, latestAnnouncedAtMs]);

  return index;
}

export function DriveScreen() {
  const masterMute = useSettingsStore((state) => state.masterMute);
  const toggleMasterMute = useSettingsStore((state) => state.toggleMasterMute);

  const isOffline = useTripStore((state) => state.isOffline);
  const bannerMessage = useTripStore((state) => state.bannerMessage);
  const locationError = useTripStore((state) => state.locationError);
  const recentAnnouncements = useTripStore((state) => state.recentAnnouncements);
  const driverPosition = useTripStore((state) => state.driverPosition);
  const driverHeadingDeg = useTripStore((state) => state.driverHeadingDeg);
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [focusedAlert, setFocusedAlert] = useState<WazeAlert | null>(null);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFocusAlert = useCallback((alert: WazeAlert) => {
    if (focusTimeoutRef.current !== null) {
      clearTimeout(focusTimeoutRef.current);
    }
    setFocusedAlert(alert);
    focusTimeoutRef.current = setTimeout(() => {
      setFocusedAlert(null);
      focusTimeoutRef.current = null;
    }, ALERT_FOCUS_DURATION_MS);
  }, []);

  useEffect(
    () => () => {
      if (focusTimeoutRef.current !== null) clearTimeout(focusTimeoutRef.current);
    },
    []
  );

  const nearbyAlerts = useMemo(
    () => (driverPosition ? selectNearbyAlerts(visibleAlerts, driverPosition, driverHeadingDeg) : []),
    [visibleAlerts, driverPosition, driverHeadingDeg]
  );

  const status = statusFor({ masterMute, isOffline });
  const slideIndex = useAnnouncementSlideIndex(
    recentAnnouncements.length,
    recentAnnouncements[0]?.announcedAtMs ?? null
  );
  const displayedAnnouncement = recentAnnouncements[slideIndex] ?? null;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Image source={brandBadgeImage} style={styles.brandBadge} accessibilityIgnoresInvertColors />

          <View style={styles.brandTextBlock}>
            <Text style={styles.brandTitle}>SHOTGUN</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: STATUS_DOT_COLOR[status] }]} />
              <Text style={styles.statusText}>
                {status === 'listening' ? 'LISTENING NEARBY' : statusLabel(status).toUpperCase()}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={toggleMasterMute}
            hitSlop={12}
            style={styles.muteButton}
            accessibilityRole="button"
            accessibilityLabel={masterMute ? 'Unmute alerts' : 'Mute alerts'}
          >
            <Text style={styles.muteIcon}>{masterMute ? '🔇' : '🔊'}</Text>
          </Pressable>
        </View>

        {bannerMessage ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{bannerMessage}</Text>
          </View>
        ) : null}

        <View style={styles.mapArea}>
          <RadarMap focusedAlert={focusedAlert} />
        </View>

        <ScrollView style={styles.lowerScroll} contentContainerStyle={styles.lowerContent}>
          <NearbyAlertsSlider nearbyAlerts={nearbyAlerts} onSelect={handleFocusAlert} />

          {locationError ? (
            <View style={[styles.gpsPill, styles.gpsPillError]}>
              <Text style={styles.gpsPillText}>LOCATION NEEDED</Text>
              <Text style={styles.gpsPillExplanation}>{locationError}</Text>
            </View>
          ) : (
            <View style={styles.gpsPill}>
              <View style={[styles.gpsDot, { backgroundColor: driverPosition ? colors.report : colors.inkFaint }]} />
              <Text style={styles.gpsPillText}>
                {driverPosition ? 'GPS ACTIVE · LOCATION ATTACHED TO REPORTS' : 'ACQUIRING GPS…'}
              </Text>
            </View>
          )}

          {displayedAnnouncement ? (
            <View style={styles.card}>
              <NearbyTransmissionCard
                key={displayedAnnouncement.alertId + displayedAnnouncement.announcedAtMs}
                announcement={displayedAnnouncement}
                nowMs={now}
              />
            </View>
          ) : null}
        </ScrollView>

        {/* Deliberately outside the ScrollView above: speed needs to stay
         * constantly visible and reachable while driving, not scroll away
         * with the rest of the content. */}
        <View style={styles.reportSection}>
          <Speedometer />
          <ReportButton />
        </View>
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  brandBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    marginRight: 12,
  },
  brandTextBlock: {
    flex: 1,
  },
  brandTitle: {
    fontFamily: fontFamily.black,
    fontSize: 18,
    letterSpacing: 2,
    color: colors.ink,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusText: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.inkMuted,
  },
  muteButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: colors.backgroundAccent,
  },
  muteIcon: {
    fontSize: 18,
  },
  banner: {
    marginTop: 4,
    marginHorizontal: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(232, 176, 75, 0.15)',
  },
  bannerText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    color: colors.warning,
    textAlign: 'center',
  },
  mapArea: {
    flex: 1.1,
    marginTop: 12,
    marginHorizontal: 20,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.backgroundAccent,
  },
  lowerScroll: {
    flex: 1,
  },
  lowerContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 16,
  },
  gpsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.backgroundAccent,
  },
  gpsPillError: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
  },
  gpsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 8,
  },
  gpsPillText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.inkMuted,
  },
  gpsPillExplanation: {
    marginTop: 6,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkMuted,
  },
  card: {
    // Wrapper kept separate from NearbyTransmissionCard's own styles so
    // this file owns inter-section spacing (the `gap` on lowerContent),
    // not the card component itself.
  },
  reportSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 16,
  },
});
