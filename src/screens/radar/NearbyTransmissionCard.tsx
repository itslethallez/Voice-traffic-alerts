import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { announcementLocation, formatDistance, labelForType } from '../../speech/formatAnnouncement';
import { speakAsync } from '../../speech/ttsAdapter';
import type { RecentAnnouncement } from '../../speech/types';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { colors } from '../../theme/colors';
import { confidenceLabel } from '../../theme/confidence';
import { fontFamily } from '../../theme/typography';
import { formatRelativeTime } from '../formatRelativeTime';

interface NearbyTransmissionCardProps {
  announcement: RecentAnnouncement;
  nowMs: number;
}

/**
 * The mockup's "Nearby transmission" card - the most recently spoken
 * announcement, shown with structured detail (street/suburb/direction,
 * distance, confidence) rather than the flat spoken sentence. The play
 * button really does replay the announcement through the same TTS
 * adapter live driving uses; the waveform next to it is decorative (no
 * audio buffer from a past ElevenLabs clip is retained to draw a real one
 * from - see the WAVEFORM_BAR_HEIGHTS comment below).
 */
export function NearbyTransmissionCard({ announcement, nowMs }: NearbyTransmissionCardProps) {
  const [replaying, setReplaying] = useState(false);
  const { candidate } = announcement;
  const meta = alertTypeMeta(candidate.alert.type);
  const location = announcementLocation(candidate);
  const title = location.street
    ? `${location.street}, ${location.direction}bound`
    : location.area
      ? `${location.area}, ${location.direction}bound`
      : `${formatDistance(candidate.distanceMeters)} ahead`;

  const handleReplay = () => {
    if (replaying) return;
    setReplaying(true);
    speakAsync(announcement.text).finally(() => setReplaying(false));
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.signalIcon}>{'📶'}</Text>
        <Text style={styles.headerLabel}>NEARBY TRANSMISSION</Text>
        <Text style={styles.headerTime}>
          {formatRelativeTime(announcement.announcedAtMs, nowMs).toUpperCase()}
        </Text>
      </View>

      <View style={styles.bodyRow}>
        <View style={[styles.avatar, { borderColor: meta.color }]}>
          <Text style={styles.avatarEmoji}>{meta.emoji}</Text>
        </View>
        <View style={styles.bodyText}>
          <Text style={styles.subtitle}>{labelForType(candidate.alert.type)} reported nearby</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>
            {formatDistance(candidate.distanceMeters)} ·{' '}
            {confidenceLabel(candidate.alert.alert_reliability)}
          </Text>
        </View>
      </View>

      <View style={styles.waveformRow}>
        <View style={styles.waveform} pointerEvents="none">
          {WAVEFORM_BAR_HEIGHTS.map((height, index) => (
            <View key={index} style={[styles.waveformBar, { height }]} />
          ))}
        </View>
        <Pressable
          onPress={handleReplay}
          style={styles.playButton}
          accessibilityRole="button"
          accessibilityLabel="Replay this announcement"
        >
          <Text style={styles.playIcon}>{replaying ? '■' : '▶'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const WAVEFORM_BAR_HEIGHTS = [6, 12, 8, 16, 10, 18, 9, 14, 7, 16, 11, 6, 13, 9];

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: colors.backgroundAccent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(245, 245, 247, 0.12)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  signalIcon: {
    marginRight: 8,
    fontSize: 12,
  },
  headerLabel: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.accent,
  },
  headerTime: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    color: colors.inkFaint,
  },
  bodyRow: {
    flexDirection: 'row',
    marginTop: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1.5,
    marginRight: 12,
  },
  avatarEmoji: {
    fontSize: 20,
  },
  bodyText: {
    flex: 1,
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: colors.inkMuted,
  },
  title: {
    marginTop: 2,
    fontFamily: fontFamily.bold,
    fontSize: 20,
    color: colors.ink,
  },
  meta: {
    marginTop: 4,
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: colors.inkFaint,
  },
  waveformRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 20,
  },
  waveformBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  playButton: {
    marginLeft: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentDim,
  },
  playIcon: {
    fontSize: 13,
    color: colors.ink,
  },
});
