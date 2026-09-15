import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RangeSlider } from '../components/RangeSlider';
import {
  ALERT_CATEGORIES,
  MAX_ANNOUNCE_DISTANCE_METERS,
  MAX_BRIEFING_RADIUS_METERS,
  MAX_VOICE_RATE,
  MIN_ANNOUNCE_DISTANCE_METERS,
  MIN_BRIEFING_RADIUS_METERS,
  MIN_VOICE_RATE,
  ROUTE_TYPES,
  type AlertCategory,
  type RouteType,
} from '../store/settingsDefaults';
import { useSettingsStore } from '../store/useSettingsStore';
import { hud, instrument } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { BuildInfoCard } from './BuildInfoCard';
import type { FacebookNotificationSourceControls } from '../notifications/useFacebookNotificationSource';

const CATEGORY_LABELS: Record<AlertCategory, string> = {
  POLICE: 'Police',
  ACCIDENT: 'Accidents',
  HAZARD: 'Hazards',
  ROAD_CLOSED: 'Road closures',
  JAM: 'Traffic jams',
};

const ROUTE_TYPE_LABELS: Record<RouteType, string> = {
  quickest: 'Quickest',
  safest: 'Safest',
  sidestreets: 'Sidestreets',
};

/** The big numeral always keeps one decimal ("5.0") - distinct from
 * formatKmTrimmed's slider-end-label style ("5"), matching the two
 * different formats measured in the design artboard. */
function formatKmFixed1(meters: number): string {
  return (meters / 1000).toFixed(1);
}

/** Slider end labels drop a redundant ".0" ("1", "20") but keep a real
 * decimal ("0.5") - matches the artboard's WARN ME FROM / BRIEF ME WITHIN
 * end labels exactly. */
function formatKmTrimmed(meters: number): string {
  const km = meters / 1000;
  return Number.isInteger(km) ? String(km) : km.toFixed(1);
}

type VoiceControl = 'volume' | 'rate';

interface SettingsScreenProps {
  onClose?: () => void;
  notificationSource: FacebookNotificationSourceControls;
}

export function SettingsScreen({ onClose, notificationSource }: SettingsScreenProps) {
  const categoriesEnabled = useSettingsStore((state) => state.categoriesEnabled);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);
  const briefingRadiusMeters = useSettingsStore((state) => state.briefingRadiusMeters);
  const voiceVolume = useSettingsStore((state) => state.voiceVolume);
  const voiceRate = useSettingsStore((state) => state.voiceRate);
  const masterMute = useSettingsStore((state) => state.masterMute);
  const defaultRouteType = useSettingsStore((state) => state.defaultRouteType);
  const setDefaultRouteType = useSettingsStore((state) => state.setDefaultRouteType);
  const toggleCategory = useSettingsStore((state) => state.toggleCategory);
  const setAnnounceDistanceMeters = useSettingsStore((state) => state.setAnnounceDistanceMeters);
  const setBriefingRadiusMeters = useSettingsStore((state) => state.setBriefingRadiusMeters);
  const setVoiceVolume = useSettingsStore((state) => state.setVoiceVolume);
  const setVoiceRate = useSettingsStore((state) => state.setVoiceRate);
  const toggleMasterMute = useSettingsStore((state) => state.toggleMasterMute);

  /** Which of Volume/Rate is expanded to show its slider - the design
   * artboard only shows the closed state, so this interaction (tap to
   * reveal a RangeSlider inline, reusing the same component Range uses) is
   * my own call, not a measured spec. At most one open at a time. */
  const [expandedVoiceControl, setExpandedVoiceControl] = useState<VoiceControl | null>(null);
  const toggleVoiceControl = (control: VoiceControl) =>
    setExpandedVoiceControl((current) => (current === control ? null : control));

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Image source={require('../../assets/shotgun-icon.png')} style={styles.brandIcon} resizeMode="contain" />
            <Text style={styles.title}>SETTINGS</Text>
            <View style={styles.headerSpacer} />
            <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button">
              <Text style={styles.doneText}>DONE</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.sectionLabelBottomOnly}>
            <Text style={styles.sectionLabelText}>SPEAK THESE</Text>
          </View>
          {ALERT_CATEGORIES.map((category) => {
            const enabled = categoriesEnabled[category];
            return (
              <Pressable
                key={category}
                onPress={() => toggleCategory(category)}
                style={styles.categoryRow}
                accessibilityRole="switch"
                accessibilityState={{ checked: enabled }}
                accessibilityLabel={CATEGORY_LABELS[category]}
              >
                <Text style={[styles.categoryLabel, !enabled && styles.mutedText]}>
                  {CATEGORY_LABELS[category]}
                </Text>
                <View style={[styles.stateBlock, enabled ? styles.stateBlockOn : styles.stateBlockOff]}>
                  <Text style={[styles.stateBlockText, enabled ? styles.stateBlockTextOn : styles.mutedText]}>
                    {enabled ? 'ON' : 'OFF'}
                  </Text>
                </View>
              </Pressable>
            );
          })}

          <View style={styles.sectionLabel}>
            <Text style={styles.sectionLabelText}>RANGE</Text>
          </View>

          <View style={styles.rangeRow}>
            <View style={styles.rangeHeaderRow}>
              <Text style={styles.rangeLabel}>WARN ME FROM</Text>
              <Text style={styles.rangeValue}>{formatKmFixed1(announceDistanceMeters)}</Text>
              <Text style={styles.rangeUnit}>KM</Text>
            </View>
            <View style={styles.rangeSliderWrap}>
              <RangeSlider
                value={announceDistanceMeters}
                min={MIN_ANNOUNCE_DISTANCE_METERS}
                max={MAX_ANNOUNCE_DISTANCE_METERS}
                step={100}
                onChange={setAnnounceDistanceMeters}
                minLabel={formatKmTrimmed(MIN_ANNOUNCE_DISTANCE_METERS)}
                maxLabel={`${formatKmTrimmed(MAX_ANNOUNCE_DISTANCE_METERS)} KM`}
              />
            </View>
          </View>

          <View style={styles.rangeRow}>
            <View style={styles.rangeHeaderRow}>
              <Text style={styles.rangeLabel}>BRIEF ME WITHIN</Text>
              <Text style={styles.rangeValue}>{formatKmFixed1(briefingRadiusMeters)}</Text>
              <Text style={styles.rangeUnit}>KM</Text>
            </View>
            <View style={styles.rangeSliderWrap}>
              <RangeSlider
                value={briefingRadiusMeters}
                min={MIN_BRIEFING_RADIUS_METERS}
                max={MAX_BRIEFING_RADIUS_METERS}
                step={500}
                onChange={setBriefingRadiusMeters}
                minLabel={formatKmTrimmed(MIN_BRIEFING_RADIUS_METERS)}
                maxLabel={`${formatKmTrimmed(MAX_BRIEFING_RADIUS_METERS)} KM`}
              />
            </View>
          </View>

          <View style={styles.sectionLabel}>
            <Text style={styles.sectionLabelText}>VOICE</Text>
          </View>

          <View style={styles.voiceRow}>
            <Pressable style={styles.voiceCell} onPress={() => toggleVoiceControl('volume')}>
              <Text style={styles.voiceCaption}>VOLUME</Text>
              <View style={styles.voiceValueRow}>
                <Text style={styles.voiceValue}>{Math.round(voiceVolume * 100)}</Text>
                <Text style={styles.voiceUnit}>%</Text>
              </View>
            </Pressable>
            <Pressable style={[styles.voiceCell, styles.voiceCellRight]} onPress={() => toggleVoiceControl('rate')}>
              <Text style={styles.voiceCaption}>RATE</Text>
              <View style={styles.voiceValueRow}>
                <Text style={styles.voiceValue}>{voiceRate.toFixed(1)}</Text>
                <Text style={styles.voiceUnit}>×</Text>
              </View>
            </Pressable>
          </View>

          {expandedVoiceControl === 'volume' ? (
            <View style={styles.expandedSliderRow}>
              <RangeSlider
                value={voiceVolume}
                min={0}
                max={1}
                step={0.05}
                onChange={setVoiceVolume}
                minLabel="0"
                maxLabel="100%"
              />
            </View>
          ) : null}
          {expandedVoiceControl === 'rate' ? (
            <View style={styles.expandedSliderRow}>
              <RangeSlider
                value={voiceRate}
                min={MIN_VOICE_RATE}
                max={MAX_VOICE_RATE}
                step={0.1}
                onChange={setVoiceRate}
                minLabel={`${MIN_VOICE_RATE.toFixed(1)}×`}
                maxLabel={`${MAX_VOICE_RATE.toFixed(1)}×`}
              />
            </View>
          ) : null}

          <Pressable
            onPress={toggleMasterMute}
            style={styles.muteRow}
            accessibilityRole="switch"
            accessibilityState={{ checked: masterMute }}
            accessibilityLabel="Mute everything"
          >
            <Text style={styles.categoryLabel}>MUTE EVERYTHING</Text>
            <View style={[styles.stateBlock, masterMute ? styles.stateBlockOn : styles.stateBlockOff]}>
              <Text style={[styles.stateBlockText, masterMute ? styles.stateBlockTextOn : styles.mutedText]}>
                {masterMute ? 'ON' : 'OFF'}
              </Text>
            </View>
          </Pressable>

          <View style={styles.sectionLabel}>
            <Text style={styles.sectionLabelText}>NAVIGATION</Text>
          </View>

          <View style={styles.routeTypeSection}>
            <Text style={styles.categoryLabel}>DEFAULT ROUTE TYPE</Text>
            <Text style={styles.routeTypeNote}>
              Starting point when you search a destination - Quickest ignores reports, Safest prefers routes with
              fewer nearby police/accident/hazard reports, Sidestreets also avoids motorways. Not a guarantee every
              hazard is missed. Can be changed per trip from the search screen.
            </Text>
            <View style={styles.routeTypeRow}>
              {ROUTE_TYPES.map((type) => {
                const isSelected = type === defaultRouteType;
                return (
                  <Pressable
                    key={type}
                    onPress={() => setDefaultRouteType(type)}
                    style={[styles.routeTypeButton, isSelected && styles.routeTypeButtonSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${ROUTE_TYPE_LABELS[type]} default route`}
                  >
                    <Text style={[styles.routeTypeButtonText, isSelected && styles.routeTypeButtonTextSelected]}>
                      {ROUTE_TYPE_LABELS[type].toUpperCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable
            style={styles.notificationSourceCard}
            onPress={() => void notificationSource.openAccessSettings()}
            accessibilityRole="button"
            accessibilityLabel={
              notificationSource.accessStatus === 'granted'
                ? 'Facebook notification access enabled'
                : 'Open Android notification access settings'
            }
          >
            <View style={styles.notificationSourceCopy}>
              <Text style={styles.notificationSourceTitle}>FACEBOOK NOTIFICATIONS</Text>
              <Text style={styles.notificationSourceBody}>
                {notificationSource.accessStatus === 'unsupported'
                  ? 'ANDROID ONLY · unavailable in this build'
                  : notificationSource.accessStatus === 'granted'
                    ? 'ACCESS ENABLED · unverified community source'
                    : 'ACCESS REQUIRED · tap to open Android settings'}
              </Text>
              <Text style={styles.notificationSourceNote}>
                Notices are sorted locally and held for review. They never become police-confirmed alerts automatically.
              </Text>
            </View>
            <View style={styles.notificationSourceBadge}>
              <Text style={styles.notificationSourceBadgeValue}>{notificationSource.pendingCount}</Text>
              <Text style={styles.notificationSourceBadgeLabel}>PENDING</Text>
            </View>
          </Pressable>

          <BuildInfoCard />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: instrument.ink,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: hud.rule,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  title: {
    fontFamily: fontFamily.black,
    fontSize: 34,
    letterSpacing: -0.5,
    color: hud.rowTitle,
  },
  brandIcon: {
    width: 40,
    height: 40,
    marginRight: 6,
  },
  headerSpacer: {
    flex: 1,
  },
  doneText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    letterSpacing: 1.5,
    color: hud.accent,
  },
  content: {
    paddingBottom: 40,
  },
  sectionLabel: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: hud.rule,
    borderBottomWidth: 1,
    borderBottomColor: hud.rule,
  },
  sectionLabelBottomOnly: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: hud.rule,
  },
  sectionLabelText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 2,
    color: hud.mutedLabel,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: hud.rowRule,
  },
  categoryLabel: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 17,
    letterSpacing: 0.5,
    color: hud.rowTitle,
  },
  mutedText: {
    color: hud.muted,
  },
  routeTypeNote: {
    marginTop: 3,
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 15,
    color: hud.muted,
  },
  routeTypeSection: {
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: hud.rowRule,
  },
  routeTypeRow: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 8,
  },
  routeTypeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderWidth: 1,
    borderColor: hud.rowRule,
  },
  routeTypeButtonSelected: {
    backgroundColor: hud.accent,
    borderColor: hud.accent,
  },
  routeTypeButtonText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 0.6,
    color: hud.muted,
  },
  routeTypeButtonTextSelected: {
    color: '#062128',
  },
  stateBlock: {
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  stateBlockOn: {
    backgroundColor: hud.accent,
  },
  stateBlockOff: {
    borderWidth: 2,
    borderColor: hud.muted,
  },
  stateBlockText: {
    fontFamily: fontFamily.black,
    fontSize: 11,
    letterSpacing: 1.5,
  },
  stateBlockTextOn: {
    color: hud.rowTitle,
  },
  rangeRow: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: hud.rowRule,
  },
  rangeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  rangeLabel: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 17,
    letterSpacing: 0.5,
    color: hud.rowTitle,
  },
  rangeValue: {
    fontFamily: fontFamily.black,
    fontSize: 26,
    lineHeight: 26,
    color: hud.rowTitle,
    fontVariant: ['tabular-nums'],
  },
  rangeUnit: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1,
    color: hud.mutedLabel,
  },
  rangeSliderWrap: {
    marginTop: 12,
  },
  voiceRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: hud.rowRule,
  },
  voiceCell: {
    flex: 1,
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  voiceCellRight: {
    borderLeftWidth: 1,
    borderLeftColor: hud.rule,
  },
  voiceCaption: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: hud.mutedLabel,
  },
  voiceValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  voiceValue: {
    fontFamily: fontFamily.black,
    fontSize: 30,
    color: hud.rowTitle,
    fontVariant: ['tabular-nums'],
  },
  voiceUnit: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    color: hud.accent,
  },
  expandedSliderRow: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: hud.rowRule,
  },
  muteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: hud.rowRule,
  },
  notificationSourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 104,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#292725',
    borderBottomWidth: 1,
    borderBottomColor: hud.rowRule,
  },
  notificationSourceCopy: {
    flex: 1,
    gap: 4,
  },
  notificationSourceTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    letterSpacing: 1.2,
    color: hud.rowTitle,
  },
  notificationSourceBody: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 0.4,
    color: hud.accentBright,
  },
  notificationSourceNote: {
    fontFamily: fontFamily.regular,
    fontSize: 11,
    lineHeight: 15,
    color: instrument.mutedOnInk,
  },
  notificationSourceBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 58,
    minHeight: 48,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: hud.ruleStrong,
  },
  notificationSourceBadgeValue: {
    fontFamily: fontFamily.black,
    fontSize: 22,
    lineHeight: 24,
    color: hud.accentBright,
  },
  notificationSourceBadgeLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 8,
    letterSpacing: 1,
    color: hud.mutedLabel,
  },
});
