import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { WazeAlert } from '../../api/waze/types';
import { env } from '../../config/env';
import { haversineDistance } from '../../geo/distance';
import { zoomForRingRadius } from '../../geo/mercatorZoom';
import { formatDistance } from '../../speech/formatAnnouncement';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTripStore } from '../../store/useTripStore';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { colors } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';
import { ALERT_PIN_BORDER_WIDTH, ALERT_PIN_SIZE } from './alertPinSize';
import { formatCompactDistance } from './formatCompactDistance';
import { PoliceLightsPin } from './PoliceLightsPin';
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

/** Used only until the first GPS fix arrives, when there's no latitude yet
 * to compute a to-scale zoom from - matches the existing "no center
 * coordinate until driverPosition exists" fallback below. */
const DEFAULT_ZOOM = 15;
/** Fixed screen size for the awareness ring; the map's Camera zoomLevel is
 * chosen (via zoomForRingRadius) so this fixed-size ring actually
 * represents announceDistanceMeters of real-world ground distance at the
 * driver's current latitude - not just a decorative circle labeled with
 * the number. */
const AWARENESS_RING_SIZE = 260;
/** Fixed zoom for a focused alert (Step 12 #25) - close enough to read the
 * marker clearly, not derived from announceDistanceMeters since a focused
 * view isn't about the driver's awareness radius. */
const FOCUSED_ALERT_ZOOM = 16;

interface RadarMapProps {
  /** Set by the Drive screen's nearby-alerts slider (Step 12 #25) when the
   * driver taps a card - the camera centers on this alert instead of
   * following the driver for a few seconds, then the caller clears it. */
  focusedAlert?: WazeAlert | null;
}

export function RadarMap({ focusedAlert = null }: RadarMapProps) {
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
            focusedAlert
              ? [focusedAlert.longitude, focusedAlert.latitude]
              : driverPosition
                ? [driverPosition.longitude, driverPosition.latitude]
                : undefined
          }
          heading={focusedAlert ? 0 : driverHeadingDeg}
          zoomLevel={
            focusedAlert
              ? FOCUSED_ALERT_ZOOM
              : driverPosition
                ? zoomForRingRadius(announceDistanceMeters, AWARENESS_RING_SIZE / 2, driverPosition.latitude)
                : DEFAULT_ZOOM
          }
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

      {focusedAlert ? null : (
        <>
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
        </>
      )}
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
      {alert.type === 'POLICE' ? (
        <PoliceLightsPin emoji={meta.emoji} />
      ) : (
        <View style={[styles.alertPin, { borderColor: meta.color }]}>
          <Text style={styles.alertEmoji}>{meta.emoji}</Text>
        </View>
      )}
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
    width: ALERT_PIN_SIZE,
    height: ALERT_PIN_SIZE,
    borderRadius: ALERT_PIN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundAccent,
    borderWidth: ALERT_PIN_BORDER_WIDTH,
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
