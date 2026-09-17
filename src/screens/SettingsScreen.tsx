import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AlertPill, type AlertPillType } from '../components/base/AlertPill';
import { Card } from '../components/base/Card';
import { Column, Row, Stack } from '../components/base/Layout';
import { ScreenContainer } from '../components/base/ScreenContainer';
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
import { alpha, colors, radii, spacing, typography } from '../theme/tokens';
import { BuildInfoCard } from './BuildInfoCard';
import type { FacebookNotificationSourceControls } from '../notifications/useFacebookNotificationSource';

/** The legacy Waze categories still own the voice-announcer toggles — each
 * maps to its normalized pill category for display (JAM reads as Traffic). */
const CATEGORY_PILL: Record<AlertCategory, AlertPillType> = {
  POLICE: 'police',
  ACCIDENT: 'accident',
  HAZARD: 'hazard',
  ROAD_CLOSED: 'closure',
  JAM: 'traffic',
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

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
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
    <ScreenContainer>
      <Row align="center" gap="sm" style={styles.header}>
        <Image
          source={require('../../assets/shotgun-icon.png')}
          style={styles.brandIcon}
          resizeMode="contain"
        />
        <Text style={styles.title}>SETTINGS</Text>
        <View style={styles.headerSpacer} />
        <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button" accessibilityLabel="Done">
          <Text style={styles.doneText}>DONE</Text>
        </Pressable>
      </Row>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Stack gap="lg">
          <Column gap="xs">
            <SectionLabel>SPEAK THESE</SectionLabel>
            <Card variant="outlined" padding="sm">
              {ALERT_CATEGORIES.map((category, index) => {
                const enabled = categoriesEnabled[category];
                return (
                  <Pressable
                    key={category}
                    onPress={() => toggleCategory(category)}
                    style={[styles.categoryRow, index > 0 && styles.rowDivider]}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: enabled }}
                    accessibilityLabel={`${CATEGORY_PILL[category]} announcements`}
                  >
                    <AlertPill
                      type={CATEGORY_PILL[category]}
                      size="sm"
                      style={!enabled ? styles.pillOff : undefined}
                    />
                    <Text
                      style={[styles.stateText, enabled ? styles.stateTextOn : styles.stateTextOff]}
                    >
                      {enabled ? 'ON' : 'OFF'}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={toggleMasterMute}
                style={[styles.categoryRow, styles.rowDivider]}
                accessibilityRole="switch"
                accessibilityState={{ checked: masterMute }}
                accessibilityLabel="Mute everything"
              >
                <Text style={styles.muteLabel}>MUTE EVERYTHING</Text>
                <Text
                  style={[styles.stateText, masterMute ? styles.stateTextOn : styles.stateTextOff]}
                >
                  {masterMute ? 'ON' : 'OFF'}
                </Text>
              </Pressable>
            </Card>
          </Column>

          <Column gap="xs">
            <SectionLabel>RANGE</SectionLabel>
            <Card variant="outlined" padding="md">
              <Stack gap="md">
                <Column gap="sm">
                  <Row align="baseline" gap="xs">
                    <Text style={styles.rowTitle}>WARN ME FROM</Text>
                    <View style={styles.headerSpacer} />
                    <Text style={styles.statValue}>{formatKmFixed1(announceDistanceMeters)}</Text>
                    <Text style={styles.statUnit}>KM</Text>
                  </Row>
                  <RangeSlider
                    value={announceDistanceMeters}
                    min={MIN_ANNOUNCE_DISTANCE_METERS}
                    max={MAX_ANNOUNCE_DISTANCE_METERS}
                    step={100}
                    onChange={setAnnounceDistanceMeters}
                    minLabel={formatKmTrimmed(MIN_ANNOUNCE_DISTANCE_METERS)}
                    maxLabel={`${formatKmTrimmed(MAX_ANNOUNCE_DISTANCE_METERS)} KM`}
                  />
                </Column>
                <Column gap="sm">
                  <Row align="baseline" gap="xs">
                    <Text style={styles.rowTitle}>BRIEF ME WITHIN</Text>
                    <View style={styles.headerSpacer} />
                    <Text style={styles.statValue}>{formatKmFixed1(briefingRadiusMeters)}</Text>
                    <Text style={styles.statUnit}>KM</Text>
                  </Row>
                  <RangeSlider
                    value={briefingRadiusMeters}
                    min={MIN_BRIEFING_RADIUS_METERS}
                    max={MAX_BRIEFING_RADIUS_METERS}
                    step={500}
                    onChange={setBriefingRadiusMeters}
                    minLabel={formatKmTrimmed(MIN_BRIEFING_RADIUS_METERS)}
                    maxLabel={`${formatKmTrimmed(MAX_BRIEFING_RADIUS_METERS)} KM`}
                  />
                </Column>
              </Stack>
            </Card>
          </Column>

          <Column gap="xs">
            <SectionLabel>VOICE</SectionLabel>
            <Card variant="outlined" padding="md">
              <Row gap="md">
                <Pressable style={styles.voiceCell} onPress={() => toggleVoiceControl('volume')}>
                  <Text style={styles.voiceCaption}>VOLUME</Text>
                  <Row align="baseline" gap="xs">
                    <Text style={styles.statValue}>{Math.round(voiceVolume * 100)}</Text>
                    <Text style={styles.voiceUnit}>%</Text>
                  </Row>
                </Pressable>
                <Pressable style={styles.voiceCell} onPress={() => toggleVoiceControl('rate')}>
                  <Text style={styles.voiceCaption}>RATE</Text>
                  <Row align="baseline" gap="xs">
                    <Text style={styles.statValue}>{voiceRate.toFixed(1)}</Text>
                    <Text style={styles.voiceUnit}>×</Text>
                  </Row>
                </Pressable>
              </Row>
              {expandedVoiceControl === 'volume' ? (
                <View style={styles.expandedSlider}>
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
                <View style={styles.expandedSlider}>
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
            </Card>
          </Column>

          <Column gap="xs">
            <SectionLabel>NAVIGATION</SectionLabel>
            <Card variant="outlined" padding="md">
              <Stack gap="sm">
                <Text style={styles.rowTitle}>DEFAULT ROUTE TYPE</Text>
                <Text style={styles.note}>
                  Starting point when you search a destination - Quickest ignores reports, Safest
                  prefers routes with fewer nearby police/accident/hazard reports, Sidestreets also
                  avoids motorways. Not a guarantee every hazard is missed. Can be changed per trip
                  from the search screen.
                </Text>
                <Row gap="xs">
                  {ROUTE_TYPES.map((type) => {
                    const isSelected = type === defaultRouteType;
                    return (
                      <Pressable
                        key={type}
                        onPress={() => setDefaultRouteType(type)}
                        style={[styles.routeButton, isSelected && styles.routeButtonSelected]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        accessibilityLabel={`${ROUTE_TYPE_LABELS[type]} default route`}
                      >
                        <Text
                          style={[
                            styles.routeButtonText,
                            isSelected && styles.routeButtonTextSelected,
                          ]}
                        >
                          {ROUTE_TYPE_LABELS[type].toUpperCase()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </Row>
              </Stack>
            </Card>
          </Column>

          <Column gap="xs">
            <SectionLabel>SOURCES</SectionLabel>
            <Pressable
              onPress={() => void notificationSource.openAccessSettings()}
              accessibilityRole="button"
              accessibilityLabel={
                notificationSource.accessStatus === 'granted'
                  ? 'Facebook notification access enabled'
                  : 'Open Android notification access settings'
              }
            >
              <Card variant="outlined" padding="md">
                <Row gap="sm" align="center">
                  <Column gap="xxs" flex={1}>
                    <Text style={styles.rowTitle}>FACEBOOK NOTIFICATIONS</Text>
                    <Text style={styles.sourceStatus}>
                      {notificationSource.accessStatus === 'unsupported'
                        ? 'ANDROID ONLY · UNAVAILABLE IN THIS BUILD'
                        : notificationSource.accessStatus === 'granted'
                          ? 'ACCESS ENABLED · UNVERIFIED COMMUNITY SOURCE'
                          : 'ACCESS REQUIRED · TAP TO OPEN ANDROID SETTINGS'}
                    </Text>
                    <Text style={styles.note}>
                      Notices are sorted locally and held for review. They never become
                      police-confirmed alerts automatically.
                    </Text>
                  </Column>
                  <Column align="center" style={styles.pendingBadge}>
                    <Text style={styles.pendingValue}>{notificationSource.pendingCount}</Text>
                    <Text style={styles.pendingLabel}>PENDING</Text>
                  </Column>
                </Row>
              </Card>
            </Pressable>
          </Column>

          <BuildInfoCard />
        </Stack>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  brandIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
  },
  title: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.heading,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textPrimary,
  },
  headerSpacer: {
    flex: 1,
  },
  doneText: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.caption,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.accent,
  },
  content: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  sectionLabel: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textMuted,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xxs,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pillOff: {
    opacity: 0.4,
  },
  stateText: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.caption,
    letterSpacing: typography.letterSpacing.eyebrow,
  },
  stateTextOn: {
    color: colors.accent,
  },
  stateTextOff: {
    color: colors.textMuted,
  },
  muteLabel: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.body,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textPrimary,
  },
  rowTitle: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.body,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textPrimary,
  },
  statValue: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.stat,
    lineHeight: typography.fontSize.stat,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  statUnit: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textMuted,
  },
  voiceCell: {
    flex: 1,
    gap: spacing.xxs,
  },
  voiceCaption: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textMuted,
  },
  voiceUnit: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.caption,
    color: colors.accent,
  },
  expandedSlider: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  note: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  routeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  routeButtonSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  routeButtonText: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textMuted,
  },
  routeButtonTextSelected: {
    color: colors.charcoal,
  },
  sourceStatus: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.accent,
  },
  pendingBadge: {
    minWidth: 56,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: alpha(colors.caution, 0.08),
  },
  pendingValue: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.title,
    lineHeight: typography.fontSize.title,
    color: colors.caution,
    fontVariant: ['tabular-nums'],
  },
  pendingLabel: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textMuted,
  },
});
