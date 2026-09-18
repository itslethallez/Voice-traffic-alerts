import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LocateFixed } from 'lucide-react-native';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { WazeAlert } from '../../api/waze/types';
import { haversineDistance } from '../../geo/distance';
import type { FixedSpeedCamera } from '../../data/fixedSpeedCameras';
import { env } from '../../config/env';
import { visibleManualReportAlerts } from '../../store/manualReportAlert';
import { visibleNearbyReportAlerts } from '../../store/nearbyReportAlert';
import { visibleTypesFromFilters } from '../../store/settingsDefaults';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTripStore } from '../../store/useTripStore';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { alpha, colors, radii, spacing, typography } from '../../theme/tokens';
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
  rangeToggleToken?: number;
}

const ADELAIDE: [number, number] = [138.6007, -34.9285];

/** Browser implementation of the map surface. Native builds continue using
 * RadarMap.tsx/@rnmapbox; Expo web resolves this file and uses Mapbox GL JS. */
export function RadarMap({ focusedAlert = null, now = Date.now(), rangeToggleToken = 0 }: RadarMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const focusTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showRange, setShowRange] = useState(false);
  const rangeToggleSeenRef = useRef(0);
  const driverPosition = useTripStore((state) => state.driverPosition);
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);
  const manualReports = useTripStore((state) => state.manualReports);
  const nearbyReports = useTripStore((state) => state.nearbyReports);
  const fixedCameras = useTripStore((state) => state.fixedCameras);
  const alertTypeFilters = useSettingsStore((state) => state.alertTypeFilters);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);

  useEffect(() => {
    if (rangeToggleToken === 0 || rangeToggleToken === rangeToggleSeenRef.current) return;
    rangeToggleSeenRef.current = rangeToggleToken;
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
  }, [rangeToggleToken]);

  const mapVisibleCameras = useMemo(() => {
    if (!driverPosition || !alertTypeFilters.fixed_camera) return [];
    return fixedCameras.filter(
      (camera) => haversineDistance(driverPosition, camera.position) <= announceDistanceMeters
    );
  }, [fixedCameras, driverPosition, alertTypeFilters.fixed_camera, announceDistanceMeters]);

  const mapVisibleAlerts = useMemo(() => {
    const enabledTypes = visibleTypesFromFilters(alertTypeFilters);
    return [
      ...visibleAlerts,
      ...visibleManualReportAlerts(manualReports, driverPosition, now, announceDistanceMeters),
      ...visibleNearbyReportAlerts(nearbyReports, driverPosition, now, announceDistanceMeters),
    ].filter((alert) => enabledTypes.has(alert.type));
  }, [visibleAlerts, manualReports, nearbyReports, driverPosition, now, announceDistanceMeters, alertTypeFilters]);

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
        background: colors.white,
        clipPath: 'polygon(50% 0, 100% 100%, 50% 78%, 0 100%)',
        filter: 'drop-shadow(0 3px 5px rgba(0,0,0,.65))',
      });
      markersRef.current.push(
        new mapboxgl.Marker({ element: driver, anchor: 'center' })
          .setLngLat([driverPosition.longitude, driverPosition.latitude])
          .addTo(map)
      );
    }

    for (const fixedCamera of mapVisibleCameras) {
      const cameraMarker = document.createElement('div');
      cameraMarker.setAttribute('aria-label', `Fixed speed camera, ${fixedCamera.label}`);
      Object.assign(cameraMarker.style, {
        position: 'relative',
        width: '36px',
        height: '32px',
        filter: 'drop-shadow(0 3px 5px rgba(0,0,0,.65))',
      });
      const cameraBody = document.createElement('div');
      Object.assign(cameraBody.style, {
        position: 'absolute',
        left: '2px',
        top: '6px',
        width: '32px',
        height: '24px',
        borderRadius: '6px',
        border: `2px solid ${colors.textPrimary}`,
        background: colors.surface,
        boxSizing: 'border-box',
      });
      const cameraBump = document.createElement('span');
      Object.assign(cameraBump.style, {
        position: 'absolute',
        left: '9px',
        top: '2px',
        width: '10px',
        height: '6px',
        borderRadius: '3px 3px 0 0',
        background: colors.textPrimary,
      });
      const cameraLens = document.createElement('span');
      Object.assign(cameraLens.style, {
        position: 'absolute',
        left: '9px',
        top: '4px',
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        border: `2px solid ${colors.textPrimary}`,
        background: colors.surface,
        boxSizing: 'border-box',
      });
      cameraBody.append(cameraLens);
      cameraMarker.append(cameraBump, cameraBody);
      markersRef.current.push(
        new mapboxgl.Marker({ element: cameraMarker, anchor: 'bottom' })
          .setLngLat([fixedCamera.position.longitude, fixedCamera.position.latitude])
          .addTo(map)
      );
    }

    for (const alert of mapRenderableAlerts) {
      const meta = alertTypeMeta(alert.type, alert.subtype);
      // Shape is the at-a-glance differentiator inside the police family
      // (all coolBlue): square + light bar = live sighting, rotated tag =
      // mobile-camera window, ring = permanent fixed camera.
      const isMobileCamera = alert.type === 'MOBILE_CAMERA';
      const isFixedCamera = alert.type === 'FIXED_CAMERA';
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.setAttribute('aria-label', `${meta.label} report${alert.street ? ` on ${alert.street}` : ''}`);
      marker.textContent = meta.letter;
      Object.assign(marker.style, {
        width: '36px',
        height: '36px',
        borderRadius: alert.type === 'POLICE' ? '4px' : isMobileCamera ? '7px' : '50%',
        border: focusedAlert?.alert_id === alert.alert_id
          ? `4px solid ${colors.accent}`
          : isFixedCamera
            ? `5px solid ${colors.coolBlue}`
            : `3px solid ${colors.white}`,
        background: isFixedCamera ? alpha(colors.coolBlue, 0.25) : meta.color,
        color: colors.white,
        font: `700 14px ${typography.fontFamily.display}, Arial, sans-serif`,
        boxShadow: `0 5px 12px ${alpha(colors.charcoal, 0.5)}`,
        cursor: 'pointer',
      });
      if (isMobileCamera) {
        marker.style.transform = 'rotate(45deg)';
        marker.textContent = '';
        const letter = document.createElement('span');
        letter.textContent = meta.letter;
        Object.assign(letter.style, { display: 'inline-block', transform: 'rotate(-45deg)' });
        marker.append(letter);
      }
      if (alert.type === 'POLICE') {
        marker.textContent = '';
        const lights = document.createElement('span');
        Object.assign(lights.style, { position: 'absolute', top: '3px', left: '6px', right: '6px', height: '7px', borderRadius: '4px', background: `linear-gradient(90deg,${colors.critical} 0 50%,${colors.coolBlue} 50%)` });
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
  }, [mapRenderableAlerts, mapVisibleCameras, driverPosition, focusedAlert?.alert_id, now]);

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
          style={[styles.recenterButton, !driverPosition && styles.recenterButtonDisabled]}
          onPress={() => {
            if (!driverPosition || !mapRef.current) return;
            setShowRange(false);
            mapRef.current.easeTo({
              center: [driverPosition.longitude, driverPosition.latitude],
              zoom: 15.5,
              pitch: 50,
              bearing: useTripStore.getState().driverHeadingDeg,
              duration: 650,
            });
          }}
          disabled={!driverPosition}
          accessibilityRole="button"
          accessibilityLabel="RECENTER ON MY LOCATION"
          accessibilityHint="Centers the map on your current location"
        >
          <LocateFixed size={20} strokeWidth={2.2} color={colors.accent} />
        </Pressable>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    position: 'relative',
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  fallbackTitle: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.body,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textPrimary,
  },
  fallbackCopy: {
    marginTop: spacing.xs,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  rangeLabelBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: 78,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.lg,
    backgroundColor: alpha(colors.charcoal, 0.94),
    borderWidth: 1,
    borderColor: colors.accent,
  },
  rangeLabelText: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.accent,
  },
  mapControls: {
    position: 'absolute',
    right: spacing.sm,
    top: 128,
    flexDirection: 'column',
    gap: spacing.xs,
  },
  recenterButton: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(colors.charcoal, 0.94),
    borderWidth: 1,
    borderColor: colors.accent,
  },
  recenterButtonDisabled: {
    opacity: 1,
  },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(colors.charcoal, 0.94),
    borderWidth: 1,
    borderColor: colors.accent,
  },
  zoomButtonGlyph: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.title,
    lineHeight: 16,
    color: colors.accent,
  },
  zoomButtonLabel: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.eyebrow,
    lineHeight: 10,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.accent,
  },
});
