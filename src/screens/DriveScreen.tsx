import { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { statusFor, statusLabel, useTripStore } from '../store/useTripStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { colors } from '../theme/colors';
import { getLastElevenLabsError } from '../speech/ttsAdapter';
import { fontFamily } from '../theme/typography';
import { NearbyTransmissionCard } from './radar/NearbyTransmissionCard';
import { RadarMap } from './radar/RadarMap';
import { ReportDial } from './radar/ReportDial';

/** Dot colour for the header's status line - lime for "actively
 * listening" (matches the Report dial's accent, reads as "go"), amber for
 * offline (a real degraded-mode warning), faint for muted (intentional,
 * not a problem). */
const STATUS_DOT_COLOR: Record<ReturnType<typeof statusFor>, string> = {
  listening: colors.report,
  offline: colors.warning,
  muted: colors.inkFaint,
};

export function DriveScreen() {
  const masterMute = useSettingsStore((state) => state.masterMute);
  const toggleMasterMute = useSettingsStore((state) => state.toggleMasterMute);

  const isOffline = useTripStore((state) => state.isOffline);
  const bannerMessage = useTripStore((state) => state.bannerMessage);
  const locationError = useTripStore((state) => state.locationError);
  const recentAnnouncements = useTripStore((state) => state.recentAnnouncements);
  const driverPosition = useTripStore((state) => state.driverPosition);

  const [now, setNow] = useState(() => Date.now());
  // Polled rather than pushed through the store: ttsAdapter.ts
  // deliberately has no store dependency, so this is the seam where the
  // UI reaches in to surface a failure that speakAsync() otherwise
  // swallows on purpose (a TTS failure must never reach the caller - see
  // ttsAdapter.ts's own comment). TEMPORARY - remove once ElevenLabs
  // voice is confirmed working end-to-end; this is here to surface the
  // exact failure reason on-device while the ElevenLabs integration is
  // still misbehaving in ways nobody can see the cause of otherwise.
  const [elevenLabsError, setElevenLabsError] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      setElevenLabsError(getLastElevenLabsError());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const status = statusFor({ masterMute, isOffline });
  const latestAnnouncement = recentAnnouncements[0] ?? null;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.brandBadge}>
            <Text style={styles.brandBadgeText}>S</Text>
          </View>
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

        {elevenLabsError ? (
          <View style={styles.debugBanner}>
            <Text style={styles.debugBannerText}>Voice fallback: {elevenLabsError}</Text>
          </View>
        ) : null}

        <View style={styles.mapArea}>
          <RadarMap />
        </View>

        <ScrollView style={styles.lowerScroll} contentContainerStyle={styles.lowerContent}>
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

          {latestAnnouncement ? (
            <View style={styles.card}>
              <NearbyTransmissionCard announcement={latestAnnouncement} nowMs={now} />
            </View>
          ) : null}
        </ScrollView>

        {/* Deliberately outside the ScrollView above: a ScrollView's pan
         * responder can steal a touch mid-hold from a Pressable nested
         * inside it, which is exactly fatal for a hold-to-confirm gesture
         * like this one - so this stays a fixed, non-scrolling section. */}
        <View style={styles.reportSection}>
          <ReportDial />
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.report,
    marginRight: 12,
  },
  brandBadgeText: {
    fontFamily: fontFamily.black,
    fontSize: 20,
    color: colors.background,
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
  debugBanner: {
    marginTop: 4,
    marginHorizontal: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(232, 93, 93, 0.15)',
  },
  debugBannerText: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    color: '#E85D5D',
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
    marginTop: 4,
    paddingBottom: 8,
  },
});
