import Slider from '@react-native-community/slider';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import {
  ALERT_CATEGORIES,
  MAX_ANNOUNCE_DISTANCE_METERS,
  MAX_BRIEFING_RADIUS_METERS,
  MAX_VOICE_RATE,
  MIN_ANNOUNCE_DISTANCE_METERS,
  MIN_BRIEFING_RADIUS_METERS,
  MIN_VOICE_RATE,
  type AlertCategory,
} from '../store/settingsDefaults';
import { useSettingsStore } from '../store/useSettingsStore';
import { colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { formatDistance } from '../speech/formatAnnouncement';
import { BuildInfoCard } from './BuildInfoCard';

const CATEGORY_LABELS: Record<AlertCategory, string> = {
  POLICE: 'Police',
  ACCIDENT: 'Accidents',
  HAZARD: 'Hazards',
  ROAD_CLOSED: 'Road closures',
  JAM: 'Traffic jams',
};

interface SettingsScreenProps {
  onClose?: () => void;
}

export function SettingsScreen({ onClose }: SettingsScreenProps) {
  const categoriesEnabled = useSettingsStore((state) => state.categoriesEnabled);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);
  const briefingRadiusMeters = useSettingsStore((state) => state.briefingRadiusMeters);
  const voiceVolume = useSettingsStore((state) => state.voiceVolume);
  const voiceRate = useSettingsStore((state) => state.voiceRate);
  const masterMute = useSettingsStore((state) => state.masterMute);
  const toggleCategory = useSettingsStore((state) => state.toggleCategory);
  const setAnnounceDistanceMeters = useSettingsStore((state) => state.setAnnounceDistanceMeters);
  const setBriefingRadiusMeters = useSettingsStore((state) => state.setBriefingRadiusMeters);
  const setVoiceVolume = useSettingsStore((state) => state.setVoiceVolume);
  const setVoiceRate = useSettingsStore((state) => state.setVoiceRate);
  const toggleMasterMute = useSettingsStore((state) => state.toggleMasterMute);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button">
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionTitle}>Alert categories</Text>
          <View style={styles.card}>
            {ALERT_CATEGORIES.map((category, index) => (
              <View
                key={category}
                style={[styles.row, index < ALERT_CATEGORIES.length - 1 && styles.rowDivider]}
              >
                <Text style={styles.rowLabel}>{CATEGORY_LABELS[category]}</Text>
                <Switch
                  value={categoriesEnabled[category]}
                  onValueChange={() => toggleCategory(category)}
                  trackColor={{ false: colors.muteButtonIdle, true: colors.accentDim }}
                  thumbColor={categoriesEnabled[category] ? colors.accent : colors.inkMuted}
                />
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Announcement distance</Text>
          <View style={styles.card}>
            <View style={styles.sliderHeader}>
              <Text style={styles.rowLabel}>Warn me from</Text>
              <Text style={styles.valueText}>{formatDistance(announceDistanceMeters)}</Text>
            </View>
            <Slider
              value={announceDistanceMeters}
              minimumValue={MIN_ANNOUNCE_DISTANCE_METERS}
              maximumValue={MAX_ANNOUNCE_DISTANCE_METERS}
              step={100}
              onValueChange={setAnnounceDistanceMeters}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.muteButtonIdle}
              thumbTintColor={colors.accent}
            />
          </View>

          <Text style={styles.sectionTitle}>Briefing radius</Text>
          <View style={styles.card}>
            <View style={styles.sliderHeader}>
              <Text style={styles.rowLabel}>Brief me within</Text>
              <Text style={styles.valueText}>{formatDistance(briefingRadiusMeters)}</Text>
            </View>
            <Slider
              value={briefingRadiusMeters}
              minimumValue={MIN_BRIEFING_RADIUS_METERS}
              maximumValue={MAX_BRIEFING_RADIUS_METERS}
              step={500}
              onValueChange={setBriefingRadiusMeters}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.muteButtonIdle}
              thumbTintColor={colors.accent}
            />
          </View>

          <Text style={styles.sectionTitle}>Voice</Text>
          <View style={styles.card}>
            <View style={styles.sliderHeader}>
              <Text style={styles.rowLabel}>Volume</Text>
              <Text style={styles.valueText}>{Math.round(voiceVolume * 100)}%</Text>
            </View>
            <Slider
              value={voiceVolume}
              minimumValue={0}
              maximumValue={1}
              step={0.05}
              onValueChange={setVoiceVolume}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.muteButtonIdle}
              thumbTintColor={colors.accent}
            />

            <View style={[styles.sliderHeader, styles.secondSlider]}>
              <Text style={styles.rowLabel}>Speaking rate</Text>
              <Text style={styles.valueText}>{voiceRate.toFixed(1)}x</Text>
            </View>
            <Slider
              value={voiceRate}
              minimumValue={MIN_VOICE_RATE}
              maximumValue={MAX_VOICE_RATE}
              step={0.1}
              onValueChange={setVoiceRate}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.muteButtonIdle}
              thumbTintColor={colors.accent}
            />
          </View>

          <Text style={styles.sectionTitle}>Master mute</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Mute all announcements</Text>
              <Switch
                value={masterMute}
                onValueChange={toggleMasterMute}
                trackColor={{ false: colors.muteButtonIdle, true: colors.accentDim }}
                thumbColor={masterMute ? colors.accent : colors.inkMuted}
              />
            </View>
          </View>

          <Text style={styles.sectionTitle}>Build</Text>
          <BuildInfoCard />
        </ScrollView>
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 28,
    color: colors.ink,
  },
  doneText: {
    fontFamily: fontFamily.medium,
    fontSize: 17,
    color: colors.accent,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    color: colors.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.backgroundAccent,
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(245, 245, 247, 0.12)',
  },
  rowLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 17,
    color: colors.ink,
  },
  sliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 16,
  },
  secondSlider: {
    marginTop: 8,
  },
  valueText: {
    fontFamily: fontFamily.medium,
    fontSize: 17,
    color: colors.inkMuted,
  },
});
