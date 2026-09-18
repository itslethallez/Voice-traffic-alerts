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
import { GlassView } from '../../components/base/GlassView';
import { MAP_STYLE_OBJECT, MAP_STYLE_STRIP_LAYERS, MAP_STYLE_URL } from '../../config/mapStyle';
import { visibleTypesFromFilters } from '../../store/settingsDefaults';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTripStore } from '../../store/useTripStore';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { alpha, colors, map3d, radii, spacing, typography } from '../../theme/tokens';
import { formatCompactDistance } from './formatCompactDistance';
import { Speedometer } from './Speedometer';

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

/** 3D design guide §2: fraction of the map height used as top camera
 * padding so the driver anchor sits in the lower third and the road ahead
 * keeps most of the frame - the same treatment RadarMap.tsx applies
 * natively through Camera padding. */
const CRUISING_LOOK_AHEAD_PADDING = 0.32;
/** Zoom at which building extrusions start fading in - matches the native
 * adapter's minZoomLevel so both platforms show the same world. */
const BUILDING_EXTRUSION_MIN_ZOOM = 13;
const DEM_SOURCE_ID = 'shotgun-terrain-dem';

/** mapbox-gl keeps transform.padding across camera ops, so this is applied
 * once via setPadding and re-applied after any fitBounds that replaced it
 * with symmetric padding. */
const lookAheadPadding = (map: { getContainer(): { clientHeight: number } }) => ({
  top: Math.round(map.getContainer().clientHeight * CRUISING_LOOK_AHEAD_PADDING),
});

/** Browser implementation of the map surface. Native builds continue using
 * RadarMap.tsx/@rnmapbox; Expo web resolves this file and uses Mapbox GL JS. */
export function RadarMap({ focusedAlert = null, now = Date.now() }: RadarMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const focusTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const driverPosition = useTripStore((state) => state.driverPosition);
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);
  const manualReports = useTripStore((state) => state.manualReports);
  const nearbyReports = useTripStore((state) => state.nearbyReports);
  const fixedCameras = useTripStore((state) => state.fixedCameras);
  const alertTypeFilters = useSettingsStore((state) => state.alertTypeFilters);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);
  const showRangeOnMap = useSettingsStore((state) => state.showRangeOnMap);
  /** Flips once the mapbox-gl instance exists - the SHOW RANGE ON MAP
   * effect depends on it so a persisted ON still frames the camera on
   * first mount (its first run sees a null mapRef and skips). */
  const [mapReady, setMapReady] = useState(false);

  /**
   * The Settings screen's SHOW RANGE ON MAP switch drives the range
   * display now (it replaced DriveScreen's old RANGE button): flipping on
   * frames the awareness circle north-up, flipping off eases back to the
   * driver-follow view.
   */
  useEffect(() => {
    markersRef.current.forEach((marker) => marker.getPopup?.()?.remove());
    if (showRangeOnMap && driverPosition && mapRef.current) {
      const delta = announceDistanceMeters / 111_320;
      mapRef.current.fitBounds(
        [[driverPosition.longitude - delta, driverPosition.latitude - delta], [driverPosition.longitude + delta, driverPosition.latitude + delta]],
        { padding: 56, pitch: 50, bearing: 0, duration: 650 }
      );
    } else if (!showRangeOnMap && driverPosition && mapRef.current) {
      // fitBounds above replaces transform.padding with its own symmetric
      // value - restore the lower-third driver anchor before easing back.
      mapRef.current.setPadding(lookAheadPadding(mapRef.current));
      mapRef.current.easeTo({
        center: [driverPosition.longitude, driverPosition.latitude],
        zoom: 15.5,
        pitch: 50,
        bearing: useTripStore.getState().driverHeadingDeg,
        duration: 650,
      });
    }
  }, [showRangeOnMap, mapReady]);

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
      // "Shotgun Night" - bundled decluttered/repaletted copy of
      // navigation-night-v1 (see src/config/mapStyle.ts); a Studio-hosted
      // style URL via EXPO_PUBLIC_MAPBOX_STYLE_URL takes over if set.
      style: MAP_STYLE_URL ?? MAP_STYLE_OBJECT,
      center,
      zoom: 15.5,
      pitch: 50,
      bearing: useTripStore.getState().driverHeadingDeg,
      padding: lookAheadPadding({ getContainer: () => hostRef.current! }),
      attributionControl: true,
    });
    mapRef.current = map;
    setMapReady(true);
    // Debug handle so local tooling (screenshots, manual camera checks) can
    // drive the map without synthesising gestures.
    Object.assign(window, { __shotgunMap: map });
    // Keep the lower-third anchor proportional when the viewport resizes.
    map.on('resize', () => map.setPadding(lookAheadPadding(map)));
    map.on('load', () => {
      // If a Studio/stock style URL ever replaces the bundled Shotgun
      // style, re-apply the §8 declutter - the bundled style already lacks
      // these ids, so this is a no-op safety net there.
      for (const layerId of MAP_STYLE_STRIP_LAYERS) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      }
      // 3D design guide §3 - the world treatment, matching the native
      // adapter's RasterDemSource/Terrain/HillshadeLayer/Atmosphere stack:
      // shaped DEM terrain with restrained hillshade for regional relief,
      // charcoal extrusions on the style's own composite source, and a
      // subtle horizon atmosphere rather than a bright game-like sky.
      map.addSource(DEM_SOURCE_ID, {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
      map.setTerrain({
        source: DEM_SOURCE_ID,
        exaggeration: ['interpolate', ['linear'], ['zoom'], 10, 1.6, 14, 1.0],
      });
      map.addLayer(
        {
          id: 'shotgun-hillshade',
          type: 'hillshade',
          source: DEM_SOURCE_ID,
          paint: {
            'hillshade-exaggeration': 0.25,
            'hillshade-shadow-color': map3d.hillshadeShadow,
            'hillshade-highlight-color': map3d.hillshadeHighlight,
          },
        },
        // Under buildings, roads and labels so carriageways stay the
        // lightest thing in view.
        map.getLayer('building-outline') ? 'building-outline' : undefined
      );
      const firstSymbolLayer = map
        .getStyle()
        .layers.find((layer: { type: string }) => layer.type === 'symbol');
      map.addLayer(
        {
          id: 'shotgun-3d-buildings',
          type: 'fill-extrusion',
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          minzoom: BUILDING_EXTRUSION_MIN_ZOOM,
          paint: {
            'fill-extrusion-color': map3d.building,
            'fill-extrusion-height': [
              'interpolate', ['linear'], ['zoom'],
              BUILDING_EXTRUSION_MIN_ZOOM, 0,
              BUILDING_EXTRUSION_MIN_ZOOM + 0.5, ['get', 'height'],
            ],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.55,
            'fill-extrusion-vertical-gradient': true,
            'fill-extrusion-ambient-occlusion-intensity': 0.35,
            // Sit on the DEM terrain instead of the flat plane so
            // extrusions on slopes don't float or bury.
            'fill-extrusion-height-alignment': 'terrain',
            'fill-extrusion-base-alignment': 'terrain',
          },
        },
        firstSymbolLayer ? firstSymbolLayer.id : undefined
      );
      map.setFog({
        range: [1.5, 20],
        color: map3d.atmosphereHorizon,
        'high-color': map3d.atmosphereHigh,
        'space-color': map3d.atmosphereSpace,
        'horizon-blend': 0.12,
        'star-intensity': 0,
      });
    });
    return () => {
      Object.assign(window, { __shotgunMap: null });
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
      {showRangeOnMap ? (
        <GlassView intensity={35} dim={0.45} pointerEvents="none" style={styles.rangeLabelBadge} accessible accessibilityLabel={`${formatCompactDistance(announceDistanceMeters)} notification range`}>
          <Text style={styles.rangeLabelText}>
            {formatCompactDistance(announceDistanceMeters).replace(/km$/, ' KM').replace(/m$/, ' M')} NOTIFICATION AREA
          </Text>
        </GlassView>
      ) : null}
      {/* The paired speed sign (design reference Im52.png): a left-edge
          capsule, vertically centred near the driver rather than parked
          in a bottom corner. Read-only - never eats a map gesture. */}
      <View style={styles.speedSignWrap} pointerEvents="none">
        <Speedometer />
      </View>
      <View style={styles.mapControls}>
        <Pressable
          style={[styles.recenterButton, !driverPosition && styles.recenterButtonDisabled]}
          onPress={() => {
            if (!driverPosition || !mapRef.current) return;
            // Recentering only returns the camera to driver-follow - the
            // SHOW RANGE ON MAP setting (and its badge) stays untouched.
            mapRef.current.setPadding(lookAheadPadding(mapRef.current));
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
          <GlassView intensity={35} dim={0.45} style={styles.controlGlass}>
            <LocateFixed size={20} strokeWidth={2.2} color={colors.accent} />
          </GlassView>
        </Pressable>
        <Pressable
          style={styles.zoomButton}
          onPress={() => mapRef.current?.zoomIn({ duration: 350 })}
          accessibilityRole="button"
          accessibilityLabel="ZOOM IN"
          accessibilityHint="Increases the map zoom by one level"
        >
          <GlassView intensity={35} dim={0.45} style={styles.controlGlass}>
            <Text style={styles.zoomButtonGlyph}>+</Text>
            <Text style={styles.zoomButtonLabel}>IN</Text>
          </GlassView>
        </Pressable>
        <Pressable
          style={styles.zoomButton}
          onPress={() => mapRef.current?.zoomOut({ duration: 350 })}
          accessibilityRole="button"
          accessibilityLabel="ZOOM OUT"
          accessibilityHint="Decreases the map zoom by one level"
        >
          <GlassView intensity={35} dim={0.45} style={styles.controlGlass}>
            <Text style={styles.zoomButtonGlyph}>−</Text>
            <Text style={styles.zoomButtonLabel}>OUT</Text>
          </GlassView>
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
  /** The paired speed sign anchors to the map's left edge at driver
   * level (the cruising look-ahead padding parks the puck in the lower
   * third, so the capsule's top edge sits just above centre). */
  speedSignWrap: {
    position: 'absolute',
    left: spacing.sm,
    top: '55%',
  },
  rangeLabelBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: 78,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: alpha(colors.accent, 0.55),
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
    // Below the collapsed top chrome (logo + mode switch + filter chip ≈
    // 160) so the buttons never sit under DriveScreen's overlay panel.
    top: 196,
    flexDirection: 'column',
    gap: spacing.xs,
  },
  recenterButton: {
    width: 44,
    height: 44,
  },
  recenterButtonDisabled: {
    opacity: 1,
  },
  zoomButton: {
    width: 44,
    height: 44,
  },
  controlGlass: {
    flex: 1,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // §8 floating chrome: backdrop blur + soft border (see GlassView).
    borderWidth: 1,
    borderColor: alpha(colors.accent, 0.45),
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
