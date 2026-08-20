import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { WazeAlert } from '../../api/waze/types';
import { env } from '../../config/env';
import { haversineDistance } from '../../geo/distance';
import { formatDistance } from '../../speech/formatAnnouncement';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTripStore } from '../../store/useTripStore';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { colors } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';
import { formatCompactDistance } from './formatCompactDistance';
import { PulseRings } from './PulseRings';

/**
 * @rnmapbox/maps throws at *import time* if its native module isn't
 * linked (Expo Go, web, or any build that predates this dependency and
 * hasn't been rebuilt since). A static top-level `import` would take
 * down the whole JS bundle before this component ever got a chance to
 * render a fallback. Loading it lazily behind a try/catch keeps that
 * throw local to this module and catchable, so everything else in the
 * app - including the rest of this radar-style Drive screen - keeps
 * working. Works the same way on both Android and iOS - the native
 * module is either linked (real dev client/EAS build) or it isn't
 * (Expo Go), regardless of platform.
 */
type MapboxModule = typeof import('@rnmapbox/maps');
let Mapbox: MapboxModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Mapbox = require('@rnmapbox/maps') as MapboxModule;
  if (env.mapboxAccessToken) {
    Mapbox.setAccessToken(env.mapboxAccessToken);
  }
} catch {
  Mapbox = null;
}

const DEFAULT_ZOOM = 15;
/** Purely decorative - a fixed-size ring standing in for "how far out
 * you'll hear about something", labeled with the real announceDistanceMeters
 * setting. Mapbox doesn't make it cheap to size a screen-space circle to
 * an exact real-world radius at an arbitrary zoom/latitude, and the
 * mockup's own ring reads as UI chrome rather than a precise map
 * measurement - so this keeps the honest part (the number) real and the
 * decorative part (the ring) simple. */
const AWARENESS_RING_SIZE = 260;

export function RadarMap() {
  const driverPosition = useTripStore((state) => state.driverPosition);
  const driverHeadingDeg = useTripStore((state) => state.driverHeadingDeg);
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);

  if (!Mapbox) {
    return (
      <Unsupported message="Radar map needs a rebuilt dev client with the Mapbox native module linked - it will not appear in Expo Go." />
    );
  }
  if (!env.mapboxAccessToken) {
    return <Unsupported message="Add EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN to .env to load the map." />;
  }

  return (
    <View style={styles.root}>
      <Mapbox.MapView
        style={styles.root}
        styleURL={Mapbox.StyleURL.Dark}
        compassEnabled={false}
        scaleBarEnabled={false}
        // Mapbox's ToS require the logo + attribution control on any map
        // using their data/styling - leave both at their (enabled) default.
        //
        // The camera below is fully driver-controlled (recentres on every
        // position update, ~3s), so manual pan/zoom/rotate gestures would
        // just get yanked back on the next update instead of doing
        // anything - disable them rather than let the map fight the user.
        scrollEnabled={false}
        zoomEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
      >
        <Mapbox.Camera
          centerCoordinate={
            driverPosition ? [driverPosition.longitude, driverPosition.latitude] : undefined
          }
          heading={driverHeadingDeg}
          zoomLevel={DEFAULT_ZOOM}
          animationMode="easeTo"
          animationDuration={600}
        />

        {driverPosition ? (
          <Mapbox.MarkerView
            coordinate={[driverPosition.longitude, driverPosition.latitude]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <PulseRings />
          </Mapbox.MarkerView>
        ) : null}

        {visibleAlerts.map((alert) => (
          <Mapbox.MarkerView
            key={alert.alert_id}
            coordinate={[alert.longitude, alert.latitude]}
            anchor={{ x: 0.5, y: 1 }}
          >
            <AlertMarker alert={alert} driverPosition={driverPosition} />
          </Mapbox.MarkerView>
        ))}
      </Mapbox.MapView>

      <View style={styles.awarenessRing} pointerEvents="none">
        <View style={styles.awarenessLabel}>
          <Text style={styles.awarenessLabelText}>
            {formatDistance(announceDistanceMeters).toUpperCase()} AWARENESS
          </Text>
        </View>
      </View>

      <View style={styles.radiusBadge} pointerEvents="none">
        <Text style={styles.radiusBadgeText}>{formatDistance(announceDistanceMeters)}</Text>
      </View>
    </View>
  );
}

function AlertMarker({
  alert,
  driverPosition,
}: {
  alert: WazeAlert;
  driverPosition: { latitude: number; longitude: number } | null;
}) {
  const meta = useMemo(() => alertTypeMeta(alert.type), [alert.type]);
  const distanceMeters = useMemo(
    () =>
      driverPosition
        ? haversineDistance(driverPosition, { latitude: alert.latitude, longitude: alert.longitude })
        : null,
    [driverPosition, alert.latitude, alert.longitude]
  );

  return (
    <View style={styles.alertMarker}>
      <View style={[styles.alertPin, { borderColor: meta.color }]}>
        <Text style={styles.alertEmoji}>{meta.emoji}</Text>
      </View>
      {distanceMeters !== null ? (
        <View style={styles.alertDistanceChip}>
          <Text style={styles.alertDistanceText}>{formatCompactDistance(distanceMeters)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Unsupported({ message }: { message: string }) {
  return (
    <View style={[styles.root, styles.unsupported]}>
      <Text style={styles.unsupportedText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  unsupported: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundAccent,
    paddingHorizontal: 32,
  },
  unsupportedText: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 22,
    color: colors.inkMuted,
    textAlign: 'center',
  },
  awarenessRing: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: AWARENESS_RING_SIZE,
    height: AWARENESS_RING_SIZE,
    marginLeft: -AWARENESS_RING_SIZE / 2,
    marginTop: -AWARENESS_RING_SIZE / 2,
    borderRadius: AWARENESS_RING_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(108, 140, 255, 0.35)',
    alignItems: 'center',
  },
  awarenessLabel: {
    marginTop: -12,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: 'rgba(108, 140, 255, 0.35)',
  },
  awarenessLabelText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.accent,
  },
  radiusBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(10, 10, 12, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(245, 245, 247, 0.15)',
  },
  radiusBadgeText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    color: colors.ink,
  },
  alertMarker: {
    alignItems: 'center',
  },
  alertPin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundAccent,
    borderWidth: 2,
  },
  alertEmoji: {
    fontSize: 16,
  },
  alertDistanceChip: {
    marginTop: 2,
    paddingVertical: 1,
    paddingHorizontal: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(10, 10, 12, 0.75)',
  },
  alertDistanceText: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    color: colors.ink,
  },
});
