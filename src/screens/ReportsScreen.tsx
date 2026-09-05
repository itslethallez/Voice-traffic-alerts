import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { WazeAlert } from '../api/waze/types';
import { visibleManualReportAlerts } from '../store/manualReportAlert';
import { visibleNearbyReportAlerts } from '../store/nearbyReportAlert';
import { enabledTypesFromSettings } from '../store/settingsDefaults';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTripStore } from '../store/useTripStore';
import { alertTypeMeta } from '../theme/alertTypeMeta';
import { hud } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { sortCurrentReportsByDistance, type CurrentReport } from './currentReports';
import { splitCompactDistance } from './radar/formatCompactDistance';
import { resolveAreaName } from '../speech/formatAnnouncement';
import { PoliceLightBar } from './radar/PoliceLightBar';

interface ReportsScreenProps {
  onSelectAlert: (alert: WazeAlert) => void;
}

export function ReportsScreen({ onSelectAlert }: ReportsScreenProps) {
  const driverPosition = useTripStore((state) => state.driverPosition);
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);
  const manualReports = useTripStore((state) => state.manualReports);
  const nearbyReports = useTripStore((state) => state.nearbyReports);
  const isOffline = useTripStore((state) => state.isOffline);
  const categoriesEnabled = useSettingsStore((state) => state.categoriesEnabled);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const reports = useMemo(() => {
    const enabledTypes = enabledTypesFromSettings(categoriesEnabled);
    const current = [
      ...visibleAlerts,
      ...visibleManualReportAlerts(manualReports, driverPosition, now, announceDistanceMeters),
      ...visibleNearbyReportAlerts(nearbyReports, driverPosition, now, announceDistanceMeters),
    ].filter((alert) => enabledTypes.has(alert.type));

    return sortCurrentReportsByDistance(current, driverPosition);
  }, [visibleAlerts, manualReports, nearbyReports, driverPosition, now, announceDistanceMeters, categoriesEnabled]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Image source={require('../../assets/shotgun-icon.png')} style={styles.brandIcon} resizeMode="contain" />
            <View style={styles.headingBlock}>
              <Text style={styles.title}>CURRENT REPORTS</Text>
              <Text style={styles.subtitle}>{driverPosition ? 'CLOSEST FIRST' : 'WAITING FOR YOUR LOCATION'}</Text>
            </View>
            <View style={styles.countPill}>
              <View style={[styles.liveDot, isOffline && styles.offlineDot]} />
              <Text style={styles.count}>{reports.length}</Text>
            </View>
          </View>
        </View>

        {!driverPosition ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Finding your location</Text>
            <Text style={styles.emptyCopy}>Reports will be ordered nearest to farthest as soon as GPS is ready.</Text>
          </View>
        ) : reports.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No current reports nearby</Text>
            <Text style={styles.emptyCopy}>New police, crash, hazard, closure and traffic reports will appear here live.</Text>
          </View>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {reports.map((report, index) => (
              <ReportRow
                key={report.alert.alert_id}
                report={report}
                rank={index + 1}
                nowMs={now}
                onPress={() => onSelectAlert(report.alert)}
              />
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function ReportRow({
  report,
  rank,
  nowMs,
  onPress,
}: {
  report: CurrentReport;
  rank: number;
  nowMs: number;
  onPress: () => void;
}) {
  const { alert, distanceMeters } = report;
  const meta = alertTypeMeta(alert.type, alert.subtype);
  const { value, unit } = splitCompactDistance(distanceMeters);
  const publishedAt = Date.parse(alert.publish_datetime_utc);
  const ageMinutes = Number.isFinite(publishedAt) ? Math.max(0, Math.round((nowMs - publishedAt) / 60_000)) : null;
  const ageLabel = ageMinutes === null ? 'LIVE' : ageMinutes < 1 ? 'JUST NOW' : `${ageMinutes} MIN AGO`;
  const place = resolveAreaName(alert) ?? alert.street ?? 'Nearby';
  const markerColor = alert.type === 'ACCIDENT' || alert.type === 'ROAD_CLOSED'
    ? hud.sevHighText
    : alert.type === 'POLICE'
      ? '#3978C5'
      : hud.sevMed;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${rank}. ${meta.label}, ${value} ${unit} away, ${place}, ${ageLabel.toLowerCase()}. Show on map.`}
    >
      <Text style={styles.rank}>{String(rank).padStart(2, '0')}</Text>
      {alert.type === 'POLICE' ? (
        <View style={[styles.marker, styles.policeMarker]}>
          <PoliceLightBar orientation="horizontal" width={34} height={10} />
          <Text style={styles.markerText}>P</Text>
        </View>
      ) : (
        <View style={[styles.marker, { backgroundColor: markerColor }]}>
          <Text style={styles.markerText}>{meta.letter}</Text>
        </View>
      )}
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>{meta.label}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>{place} · {ageLabel}</Text>
      </View>
      <View style={styles.distanceBlock}>
        <Text style={styles.distanceValue}>{value}</Text>
        <Text style={styles.distanceUnit}>{unit}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F4F7F7',
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandIcon: {
    width: 42,
    height: 42,
  },
  headingBlock: {
    flex: 1,
  },
  title: {
    fontFamily: fontFamily.black,
    fontSize: 24,
    letterSpacing: -0.5,
    color: '#07313C',
  },
  subtitle: {
    marginTop: 3,
    fontFamily: fontFamily.bold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: '#54737A',
  },
  countPill: {
    minWidth: 54,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D7E3E1',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: hud.accent,
  },
  offlineDot: {
    backgroundColor: '#8B9699',
  },
  count: {
    fontFamily: fontFamily.black,
    fontSize: 16,
    color: '#07313C',
    fontVariant: ['tabular-nums'],
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10,
  },
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCE7E5',
    shadowColor: '#183B40',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  rowPressed: {
    opacity: 0.76,
  },
  rank: {
    width: 22,
    fontFamily: fontFamily.bold,
    fontSize: 11,
    color: '#7D9498',
    fontVariant: ['tabular-nums'],
  },
  marker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
  markerText: {
    fontFamily: fontFamily.black,
    fontSize: 16,
    color: '#FFFFFF',
  },
  policeMarker: {
    overflow: 'hidden',
    backgroundColor: '#102D3A',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    color: '#07313C',
  },
  rowMeta: {
    marginTop: 4,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: '#5E777D',
  },
  distanceBlock: {
    minWidth: 52,
    alignItems: 'flex-end',
  },
  distanceValue: {
    fontFamily: fontFamily.black,
    fontSize: 22,
    color: '#07313C',
    fontVariant: ['tabular-nums'],
  },
  distanceUnit: {
    marginTop: -2,
    fontFamily: fontFamily.bold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: hud.accent,
  },
  emptyState: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 56,
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    color: '#07313C',
    textAlign: 'center',
  },
  emptyCopy: {
    marginTop: 9,
    maxWidth: 300,
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 21,
    color: '#5E777D',
    textAlign: 'center',
  },
});
