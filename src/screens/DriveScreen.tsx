import { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { statusFor, statusLabel, useTripStore } from '../store/useTripStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatRelativeTime } from './formatRelativeTime';
import { RadarMap } from './radar/RadarMap';

/** Most recent announcement first, each older one fading further. */
const ANNOUNCEMENT_OPACITY = [1, 0.6, 0.35];

interface DriveScreenProps {
  onOpenSettings?: () => void;
}

// useDriveLoop() is called from App.tsx, not here - see the comment there.
export function DriveScreen({ onOpenSettings }: DriveScreenProps) {

  const masterMute = useSettingsStore((state) => state.masterMute);
  const toggleMasterMute = useSettingsStore((state) => state.toggleMasterMute);

  const isOffline = useTripStore((state) => state.isOffline);
  const bannerMessage = useTripStore((state) => state.bannerMessage);
  const locationError = useTripStore((state) => state.locationError);
  const recentAnnouncements = useTripStore((state) => state.recentAnnouncements);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const status = statusFor({ masterMute, isOffline });

  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill}>
        <RadarMap />
      </View>
      <SafeAreaView style={styles.safeArea} pointerEvents="box-none">
        <Pressable
          onPress={onOpenSettings}
          hitSlop={16}
          style={styles.settingsButton}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
        >
          <Text style={styles.settingsIcon}>{'⚙'}</Text>
        </Pressable>

        {bannerMessage ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{bannerMessage}</Text>
          </View>
        ) : null}

        <View style={styles.statusPill} pointerEvents="none">
          {locationError ? (
            <>
              <Text style={styles.statusPillText}>Location needed</Text>
              <Text style={styles.explanationText}>{locationError}</Text>
            </>
          ) : (
            <Text style={styles.statusPillText}>{statusLabel(status)}</Text>
          )}
        </View>

        <View style={styles.bottomOverlay} pointerEvents="box-none">
          <View style={styles.announcementsList} pointerEvents="none">
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

          <Pressable
            onPress={toggleMasterMute}
            style={({ pressed }) => [
              styles.muteButton,
              { backgroundColor: pressed ? colors.muteButtonActive : colors.muteButtonIdle },
            ]}
            accessibilityRole="button"
            accessibilityLabel={masterMute ? 'Unmute alerts' : 'Mute alerts'}
          >
            <Text style={styles.muteButtonText}>{masterMute ? 'Unmute' : 'Mute'}</Text>
          </Pressable>
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
    justifyContent: 'space-between',
  },
  settingsButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 1,
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(10, 10, 12, 0.55)',
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
  /** A compact status badge over the map, replacing the old full-screen
   * centered text now that the radar map is the primary visual. */
  statusPill: {
    alignSelf: 'center',
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: 'rgba(10, 10, 12, 0.55)',
    maxWidth: '80%',
  },
  statusPillText: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    color: colors.ink,
    textAlign: 'center',
  },
  explanationText: {
    marginTop: 8,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkMuted,
    textAlign: 'center',
  },
  bottomOverlay: {
    paddingHorizontal: 32,
  },
  announcementsList: {
    marginBottom: 24,
    gap: 12,
  },
  announcementText: {
    fontFamily: fontFamily.medium,
    fontSize: 18,
    lineHeight: 24,
    color: colors.ink,
    textAlign: 'center',
    textShadowColor: 'rgba(10, 10, 12, 0.85)',
    textShadowRadius: 8,
  },
  muteButton: {
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