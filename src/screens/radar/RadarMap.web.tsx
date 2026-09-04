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
import { formatCompactDistance } from './formatCompactDistance';

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
  const focusTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const mapRenderableAlerts = useMemo(() => {
    if (!focusedAlert || mapVisibleAlerts.some((alert) => alert.alert_id === focusedAlert.alert_id)) {
      return mapVisibleAlerts;
    }
    return [...mapVisibleAlerts, focusedAlert];
  }, [mapVisibleAlerts, focusedAlert]);

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
      if (focusTransitionTimeoutRef.current !== null) {
        clearTimeout(focusTransitionTimeoutRef.current);
        focusTransitionTimeoutRef.current = null;
      }
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

    for (const alert of mapRenderableAlerts) {
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
        borderRadius: alert.type === 'POLICE' ? '4px' : '50%',
        border: focusedAlert?.alert_id === alert.alert_id ? `4px solid ${hud.accent}` : '3px solid #fff',
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
        map.easeTo({ center: [alert.longitude, alert.latitude], zoom: 16, duration: 600 });
      });
      const reportMarker = new mapboxgl.Marker({ element: marker, anchor: 'bottom' })
        .setLngLat([alert.longitude, alert.latitude])
        .setPopup(new mapboxgl.Popup({ offset: 22 }).setText(`${meta.label} · ${alert.street ?? alert.city ?? 'Location attached'} · Reported ${Math.max(0, Math.round((now - Date.parse(alert.publish_datetime_utc)) / 60000))} min ago${alert.description ? ` · ${alert.description}` : ''}`))
        .addTo(map);
      if (focusedAlert?.alert_id === alert.alert_id) reportMarker.togglePopup();
      markersRef.current.push(reportMarker);
    }
  }, [mapRenderableAlerts, driverPosition, focusedAlert?.alert_id, now]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusedAlert) return;

    if (focusTransitionTimeoutRef.current !== null) {
      clearTimeout(focusTransitionTimeoutRef.current);
    }

    if (driverPosition) {
      const bounds: [[number, number], [number, number]] = [
        [Math.min(driverPosition.longitude, focusedAlert.longitude), Math.min(driverPosition.latitude, focusedAlert.latitude)],
        [Math.max(driverPosition.longitude, focusedAlert.longitude), Math.max(driverPosition.latitude, focusedAlert.latitude)],
      ];
      map.fitBounds(bounds, { padding: 72, pitch: 50, bearing: 0, duration: 400 });
      focusTransitionTimeoutRef.current = setTimeout(() => {
        map.flyTo({ center: [focusedAlert.longitude, focusedAlert.latitude], zoom: 16, pitch: 50, bearing: 0, duration: 500 });
        focusTransitionTimeoutRef.current = null;
      }, 400);

      return () => {
        if (focusTransitionTimeoutRef.current !== null) {
          clearTimeout(focusTransitionTimeoutRef.current);
          focusTransitionTimeoutRef.current = null;
        }
      };
    }

    map.flyTo({ center: [focusedAlert.longitude, focusedAlert.latitude], zoom: 16, pitch: 50, bearing: 0, duration: 500 });
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
      {showRange ? (
        <View pointerEvents="none" style={styles.rangeLabelBadge} accessible accessibilityLabel={`${formatCompactDistance(announceDistanceMeters)} notification range`}>
          <Text style={styles.rangeLabelText}>
            {formatCompactDistance(announceDistanceMeters).replace(/km$/, ' KM').replace(/m$/, ' M')} NOTIFICATION AREA
          </Text>
        </View>
      ) : null}
      <View style={styles.mapControls}>
        <Pressable
          style={styles.zoomButton}
          onPress={() => mapRef.current?.zoomIn({ duration: 350 })}
          accessibilityRole="button"
          accessibilityLabel="ZOOM IN"
          accessibilityHint="Increases the map zoom by one level"
        >
          <Text style={styles.zoomButtonGlyph}>+</Text>
          <Text style={styles.zoomButtonLabel}>IN</Text>
        </Pressable>
        <Pressable
          style={styles.zoomButton}
          onPress={() => mapRef.current?.zoomOut({ duration: 350 })}
          accessibilityRole="button"
          accessibilityLabel="ZOOM OUT"
          accessibilityHint="Decreases the map zoom by one level"
        >
          <Text style={styles.zoomButtonGlyph}>−</Text>
          <Text style={styles.zoomButtonLabel}>OUT</Text>
        </Pressable>
        <Pressable
          style={[styles.rangeButton, showRange && styles.rangeButtonActive]}
          onPress={() => {
            const next = !showRange;
            setShowRange(next);
            markersRef.current.forEach((marker) => marker.getPopup?.()?.remove());
            if (next && driverPosition && mapRef.current) {
              const delta = announceDistanceMeters / 111_320;
              mapRef.current.fitBounds(
                [[driverPosition.longitude - delta, driverPosition.latitude - delta], [driverPosition.longitude + delta, driverPosition.latitude + delta]],
                { padding: 56, pitch: 50, bearing: 0, duration: 650 }
              );
            } else if (!next && driverPosition && mapRef.current) {
              mapRef.current.easeTo({
                center: [driverPosition.longitude, driverPosition.latitude],
                zoom: 15.5,
                pitch: 50,
                bearing: useTripStore.getState().driverHeadingDeg,
                duration: 650,
              });
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
  rangeLabelBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: 78,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(6,27,31,0.94)',
    borderWidth: 1,
    borderColor: hud.accent,
  },
  rangeLabelText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1,
    color: hud.accent,
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
  zoomButtonGlyph: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 16,
    color: hud.accent,
  },
  zoomButtonLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 8,
    lineHeight: 10,
    letterSpacing: 0.5,
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
