import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { WazeAlert } from '../../api/waze/types';
import { env } from '../../config/env';
import { visibleManualReportAlerts } from '../../store/manualReportAlert';
import { visibleNearbyReportAlerts } from '../../store/nearbyReportAlert';
import { enabledTypesFromSettings } from '../../store/settingsDefaults';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTripStore } from '../../store/useTripStore';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { hud } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';

// Keep Mapbox GL's very deep style-expression generics outside the Expo/RN
// project type graph; this platform adapter is exercised by the web export.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mapboxgl: any = require('mapbox-gl').default ?? require('mapbox-gl');

interface RadarMapProps {
  focusedAlert?: WazeAlert | null;
  now?: number;
  onSpotlightChange?: (active: boolean) => void;
  minimal?: boolean;
}

const ADELAIDE: [number, number] = [138.6007, -34.9285];

/** Browser implementation of the map surface. Native builds continue using
 * RadarMap.tsx/@rnmapbox; Expo web resolves this file and uses Mapbox GL JS. */
export function RadarMap({ focusedAlert = null, now = Date.now() }: RadarMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [showRange, setShowRange] = useState(false);
  const driverPosition = useTripStore((state) => state.driverPosition);
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);
  const manualReports = useTripStore((state) => state.manualReports);
  const nearbyReports = useTripStore((state) => state.nearbyReports);
  const categoriesEnabled = useSettingsStore((state) => state.categoriesEnabled);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);

  const mapVisibleAlerts = useMemo(() => {
    const enabledTypes = enabledTypesFromSettings(categoriesEnabled);
    return [
      ...visibleAlerts,
      ...visibleManualReportAlerts(manualReports, driverPosition, now, announceDistanceMeters),
      ...visibleNearbyReportAlerts(nearbyReports, driverPosition, now, announceDistanceMeters),
    ].filter((alert) => enabledTypes.has(alert.type));
  }, [visibleAlerts, manualReports, nearbyReports, driverPosition, now, announceDistanceMeters, categoriesEnabled]);

  useEffect(() => {
    if (!hostRef.current || !env.mapboxAccessToken) return;
    mapboxgl.accessToken = env.mapboxAccessToken;
    const center: [number, number] = driverPosition
      ? [driverPosition.longitude, driverPosition.latitude]
      : ADELAIDE;
    const map = new mapboxgl.Map({
      container: hostRef.current,
      style: 'mapbox://styles/mapbox/navigation-night-v1',
      center,
      zoom: 15.5,
      pitch: 50,
      bearing: useTripStore.getState().driverHeadingDeg,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (driverPosition) {
      const driver = document.createElement('div');
      driver.setAttribute('aria-label', 'Your current location');
      Object.assign(driver.style, {
        width: '24px',
        height: '30px',
        background: '#ffffff',
        clipPath: 'polygon(50% 0, 100% 100%, 50% 78%, 0 100%)',
        filter: 'drop-shadow(0 3px 5px rgba(0,0,0,.65))',
      });
      markersRef.current.push(
        new mapboxgl.Marker({ element: driver, anchor: 'center' })
          .setLngLat([driverPosition.longitude, driverPosition.latitude])
          .addTo(map)
      );
    }

    for (const alert of mapVisibleAlerts) {
      const meta = alertTypeMeta(alert.type, alert.subtype);
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.setAttribute('aria-label', `${meta.label} report${alert.street ? ` on ${alert.street}` : ''}`);
      marker.textContent = meta.letter;
      const color = alert.type === 'POLICE'
        ? '#3978C5'
        : alert.type === 'ACCIDENT' || alert.type === 'ROAD_CLOSED'
          ? '#E34F45'
          : alert.type === 'HAZARD' || alert.type === 'JAM'
            ? '#E8930C'
            : meta.color;
      Object.assign(marker.style, {
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        border: '3px solid #fff',
        background: color,
        color: '#fff',
        font: '800 14px Archivo, Arial, sans-serif',
        boxShadow: '0 5px 12px rgba(0,0,0,.5)',
        cursor: 'pointer',
      });
      if (alert.type === 'POLICE') {
        marker.textContent = '';
        const lights = document.createElement('span');
        Object.assign(lights.style, { position: 'absolute', top: '3px', left: '6px', right: '6px', height: '7px', borderRadius: '4px', background: 'linear-gradient(90deg,#ff3d3d 0 50%,#3d6bff 50%)' });
        const letter = document.createElement('span');
        letter.textContent = 'P';
        Object.assign(letter.style, { position: 'absolute', left: '0', right: '0', bottom: '4px' });
        marker.append(lights, letter);
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          lights.animate([{ filter: 'brightness(1.8)' }, { filter: 'brightness(.55)' }, { filter: 'brightness(1.8)' }], { duration: 620, iterations: Infinity });
        }
      }
      marker.addEventListener('click', () => {
        map.flyTo({ center: [alert.longitude, alert.latitude], zoom: 16, duration: 600 });
      });
      markersRef.current.push(
        new mapboxgl.Marker({ element: marker, anchor: 'bottom' })
          .setLngLat([alert.longitude, alert.latitude])
          .setPopup(new mapboxgl.Popup({ offset: 22 }).setText(`${meta.label} · ${alert.street ?? alert.city ?? 'Location attached'} · Reported ${Math.max(0, Math.round((now - Date.parse(alert.publish_datetime_utc)) / 60000))} min ago${alert.description ? ` · ${alert.description}` : ''}`))
          .addTo(map)
      );
    }
  }, [mapVisibleAlerts, driverPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusedAlert) return;
    map.flyTo({ center: [focusedAlert.longitude, focusedAlert.latitude], zoom: 16, duration: 700 });
  }, [focusedAlert?.alert_id]);

  if (!env.mapboxAccessToken) {
    return (
      <View style={[styles.root, styles.fallback]} accessibilityLabel="Map unavailable because the Mapbox token is missing">
        <Text style={styles.fallbackTitle}>MAP UNAVAILABLE</Text>
        <Text style={styles.fallbackCopy}>Add EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN to load the live web map.</Text>
      </View>
    );
  }

  return (
    <View
      style={styles.root}
      accessible
      accessibilityLabel={`LIVE WEB MAP with ${mapVisibleAlerts.length} current reports`}
    >
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {showRange && driverPosition ? (
        <View pointerEvents="none" style={styles.radarRange} accessible accessibilityLabel={`${Math.round(announceDistanceMeters / 100) / 10} kilometre notification range`}>
          <View style={styles.radarRangeInner} />
        </View>
      ) : null}
      <View style={styles.mapControls}>
        <Pressable
          style={styles.zoomButton}
          onPress={() => mapRef.current?.zoomIn({ duration: 350 })}
          accessibilityRole="button"
          accessibilityLabel="ZOOM IN"
        ><Text style={styles.zoomButtonText}>+</Text></Pressable>
        <Pressable
          style={styles.zoomButton}
          onPress={() => mapRef.current?.zoomOut({ duration: 350 })}
          accessibilityRole="button"
          accessibilityLabel="ZOOM OUT"
        ><Text style={styles.zoomButtonText}>−</Text></Pressable>
        <Pressable
          style={[styles.rangeButton, showRange && styles.rangeButtonActive]}
          onPress={() => {
            const next = !showRange;
            setShowRange(next);
            if (next && driverPosition && mapRef.current) {
              const delta = announceDistanceMeters / 111_320;
              mapRef.current.fitBounds(
                [[driverPosition.longitude - delta, driverPosition.latitude - delta], [driverPosition.longitude + delta, driverPosition.latitude + delta]],
                { padding: 56, pitch: 50, bearing: useTripStore.getState().driverHeadingDeg, duration: 650 }
              );
            }
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: showRange }}
          accessibilityLabel="SHOW WARN RANGE"
        ><Text style={[styles.rangeButtonText, showRange && styles.rangeButtonTextActive]}>{showRange ? 'NEAREST' : 'RANGE'}</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    position: 'relative',
    backgroundColor: hud.mapGround,
    overflow: 'hidden',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  fallbackTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    letterSpacing: 1.5,
    color: hud.rowTitle,
  },
  fallbackCopy: {
    marginTop: 8,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 20,
    color: hud.muted,
    textAlign: 'center',
  },
  radarRange: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 240,
    height: 240,
    marginLeft: -120,
    marginTop: -120,
    borderRadius: 120,
    borderWidth: 2,
    borderColor: hud.accent,
    backgroundColor: 'rgba(38,185,154,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarRangeInner: {
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 1,
    borderColor: 'rgba(69,209,181,0.58)',
  },
  mapControls: {
    position: 'absolute',
    right: 14,
    top: 78,
    flexDirection: 'row',
    gap: 7,
  },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6,27,31,0.94)',
    borderWidth: 1,
    borderColor: hud.accent,
  },
  zoomButtonText: {
    fontFamily: fontFamily.bold,
    fontSize: 24,
    lineHeight: 25,
    color: hud.accent,
  },
  rangeButton: {
    minWidth: 62,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(6,27,31,0.94)',
    borderWidth: 1,
    borderColor: hud.accent,
  },
  rangeButtonActive: {
    backgroundColor: hud.accent,
  },
  rangeButtonText: {
    fontFamily: fontFamily.bold,
    fontSize: 9,
    letterSpacing: 0.8,
    color: hud.accent,
  },
  rangeButtonTextActive: {
    color: '#062128',
  },
});
