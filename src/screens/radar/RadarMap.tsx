import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { WazeAlert } from '../../api/waze/types';
import { env } from '../../config/env';
import { useTripStore } from '../../store/useTripStore';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { colors } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';
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

export function RadarMap() {
  const driverPosition = useTripStore((state) => state.driverPosition);
  const driverHeadingDeg = useTripStore((state) => state.driverHeadingDeg);
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);

  if (!Mapbox) {
    return (
      <Unsupported message="Radar map needs a rebuilt dev client with the Mapbox native module linked - it will not appear in Expo Go." />
    );
  }
  if (!env.mapboxAccessToken) {
    return <Unsupported message="Add EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN to .env to load the map." />;
  }

  return (
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
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <AlertMarker alert={alert} />
        </Mapbox.MarkerView>
      ))}
    </Mapbox.MapView>
  );
}

function AlertMarker({ alert }: { alert: WazeAlert }) {
  const meta = useMemo(() => alertTypeMeta(alert.type), [alert.type]);
  return (
    <View style={[styles.alertDot, { backgroundColor: meta.color }]}>
      <Text style={styles.alertGlyph}>{meta.label.charAt(0).toUpperCase()}</Text>
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
  alertDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  alertGlyph: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    color: colors.ink,
  },
});
