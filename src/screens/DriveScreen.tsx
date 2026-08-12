import { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { statusFor, statusLabel, useTripStore } from '../store/useTripStore';
import { formatRelativeTime } from './formatRelativeTime';
import { useDriveLoop } from './useDriveLoop';

/** Most recent announcement first, each older one fading further. */
const ANNOUNCEMENT_OPACITY = [1, 0.6, 0.35];

interface DriveScreenProps {
  /** No-op until Step 7 builds the Settings screen and App.tsx wires real navigation. */
  onOpenSettings?: () => void;
}

export function DriveScreen({ onOpenSettings }: DriveScreenProps) {
  useDriveLoop();

  const isMuted = useTripStore((state) => state.isMuted);
  const isOffline = useTripStore((state) => state.isOffline);
  const rateLimitBannerVisible = useTripStore((state) => state.rateLimitBannerVisible);
  const locationError = useTripStore((state) => state.locationError);
  const recentAnnouncements = useTripStore((state) => state.recentAnnouncements);
  const toggleMute = useTripStore((state) => state.toggleMute);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const status = statusFor({ isMuted, isOffline });

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.backgroundAccent, colors.background]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safeArea}>
        <Pressable
          onPress={onOpenSettings}
          hitSlop={16}
          style={styles.settingsButton}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
        >
          <Text style={styles.settingsIcon}>{'⚙'}</Text>
        </Pressable>

        {rateLimitBannerVisible ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Requests are being limited. Retrying shortly.</Text>
          </View>
        ) : null}

        <View style={styles.centerContent}>
          {locationError ? (
            <>
              <Text style={styles.statusText}>Location needed</Text>
              <Text style={styles.explanationText}>{locationError}</Text>
            </>
          ) : (
            <Text style={styles.statusText}>{statusLabel(status)}</Text>
          )}

          <View style={styles.announcementsList}>
            {recentAnnouncements.map((announcement, index) => (
              <Text
                key={`${announcement.alertId}-${announcement.announcedAtMs}`}
                style={[
                  styles.announcementText,
                  { opacity: ANNOUNCEMENT_OPACITY[index] ?? ANNOUNCEMENT_OPACITY.at(-1) },
                ]}
              >
                {announcement.text} {formatRelativeTime(announcement.announcedAtMs, now)}
              </Text>
            ))}
          </View>
        </View>

        <Pressable
          onPress={toggleMute}
          style={({ pressed }) => [
            styles.muteButton,
            { backgroundColor: pressed ? colors.muteButtonActive : colors.muteButtonIdle },
          ]}
          accessibilityRole="button"
          accessibilityLabel={isMuted ? 'Unmute alerts' : 'Mute alerts'}
        >
          <Text style={styles.muteButtonText}>{isMuted ? 'Unmute' : 'Mute'}</Text>
        </Pressable>
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
  settingsButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 1,
    padding: 8,
  },
  settingsIcon: {
    fontSize: 28,
    color: colors.inkMuted,
  },
  banner: {
    marginTop: 16,
    marginHorizontal: 24,
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
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  statusText: {
    fontFamily: fontFamily.black,
    fontSize: 64,
    color: colors.ink,
    textAlign: 'center',
  },
  explanationText: {
    marginTop: 16,
    fontFamily: fontFamily.regular,
    fontSize: 24,
    lineHeight: 32,
    color: colors.inkMuted,
    textAlign: 'center',
  },
  announcementsList: {
    marginTop: 40,
    width: '100%',
    gap: 16,
  },
  announcementText: {
    fontFamily: fontFamily.medium,
    fontSize: 24,
    lineHeight: 30,
    color: colors.ink,
    textAlign: 'center',
  },
  muteButton: {
    marginHorizontal: 32,
    marginBottom: 32,
    minHeight: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteButtonText: {
    fontFamily: fontFamily.bold,
    fontSize: 28,
    color: colors.ink,
  },
});
