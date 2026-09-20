import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LocateFixed } from 'lucide-react-native';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { WazeAlert } from '../../api/waze/types';
import { haversineDistance } from '../../geo/distance';
import { clusterMarkers, markerSeparationMeters } from '../../geo/declutterMarkers';
import type { FixedSpeedCamera } from '../../data/fixedSpeedCameras';
import {
  baseExaggerationAtZoom,
  exaggerationScaleForRelief,
  reliefSamplePoints,
  scaledExaggerationExpression,
  TERRAIN_RELIEF_RESAMPLE_DISTANCE_M,
  trimmedReliefM,
  trueReliefFromMeasured,
} from '../../geo/terrainRelief';
import { env } from '../../config/env';
import { visibleManualReportAlerts } from '../../store/manualReportAlert';
import { visibleNearbyReportAlerts } from '../../store/nearbyReportAlert';
import { GlassView } from '../../components/base/GlassView';
import { MAP_STYLE_OBJECT, MAP_STYLE_STRIP_LAYERS, MAP_STYLE_URL } from '../../config/mapStyle';
import { visibleTypesFromFilters } from '../../store/settingsDefaults';
import { nearestPointOnPolyline } from '../../geo/routePolyline';
import { useNavigationStore } from '../../store/useNavigationStore';
import { useRouteOptionsStore } from '../../store/useRouteOptionsStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTripStore } from '../../store/useTripStore';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { alpha, colors, map3d, radii, spacing, typography } from '../../theme/tokens';
import { formatCompactDistance } from './formatCompactDistance';
import { ROUTE_OPTION_COLORS } from './routeOptionPresentation';
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
  /** Absolute y of the bottom edge of DriveScreen's measured top overlay
   * chrome (safe-area inset + panel content, including the ManeuverBanner
   * while navigating) - the map's own floating controls start below it.
   * Same contract as RadarMap.tsx. */
  topOverlayBottom?: number;
}

/** Pre-measurement fallback for topOverlayBottom - see RadarMap.tsx. */
const TOP_OVERLAY_FALLBACK = 170;

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
/** Fixed heading-up follow zoom while navigating - the web counterpart of
 * RadarMap.tsx's NAVIGATING_ZOOM: tighter than the cruising view, a normal
 * turn-by-turn driving framing. */
const NAVIGATING_ZOOM = 17;
/**
 * §7 Navigate personality: lower and more forward-tilted than cruising.
 * Matches RadarMap.tsx's NAVIGATING_PITCH/CRUISING_PITCH.
 */
const NAVIGATING_PITCH = 62;
const CRUISING_PITCH = 50;

/** mapbox-gl keeps transform.padding across camera ops, so this is applied
 * once via setPadding and re-applied after any fitBounds that replaced it
 * with symmetric padding. */
const lookAheadPadding = (map: { getContainer(): { clientHeight: number } }) => ({
  top: Math.round(map.getContainer().clientHeight * CRUISING_LOOK_AHEAD_PADDING),
});

/** Browser implementation of the map surface. Native builds continue using
 * RadarMap.tsx/@rnmapbox; Expo web resolves this file and uses Mapbox GL JS. */
export function RadarMap({ focusedAlert = null, now = Date.now(), topOverlayBottom = TOP_OVERLAY_FALLBACK }: RadarMapProps) {
  const insets = useSafeAreaInsets();
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
  /** Stage B's route-option previews - the web counterpart of the
   * route-option ShapeSources in RadarMap.tsx: all candidates drawn at
   * once, selected emphasised, cleared wholesale with the plan. */
  const routeOptionsStatus = useRouteOptionsStore((state) => state.status);
  const routeOptions = useRouteOptionsStore((state) => state.options);
  const selectedRouteOptionId = useRouteOptionsStore((state) => state.selectedId);
  const routeOptionsWereShownRef = useRef(false);
  /** Stage C's active navigation - the single committed route the
   * RouteOptionsPanel's GO button produced (routeOptions' previews stand
   * down at the same moment). The line, the top maneuver banner, and the
   * heading-up follow camera all read from this. */
  const navigationStatus = useNavigationStore((state) => state.status);
  const activeRoute = useNavigationStore((state) => state.activeRoute);
  const isNavigating = navigationStatus === 'navigating' || navigationStatus === 'rerouting';

  /**
   * The on-map driver position. While navigating, the marker (and the
   * follow camera) rides the route polyline via nearestPointOnPolyline -
   * a display-only snap; the engine still sees the raw fix, and an
   * off-route position gets dragged onto the line visually until
   * navigationRuntime's deviation check reroutes. Deliberately not map
   * matching (see routePolyline.ts).
   */
  const displayDriverPosition = useMemo(
    () =>
      isNavigating && activeRoute && driverPosition
        ? nearestPointOnPolyline(driverPosition, activeRoute.polyline)
        : driverPosition,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isNavigating, activeRoute, driverPosition?.latitude, driverPosition?.longitude]
  );

  /**
   * Terrain-drape legibility fix (geo/terrainRelief.ts): draped line
   * layers follow DEM noise in flat areas, making straight streets wavy.
   * Samples the DEM's own elevations on a ring around the driver and
   * scales exaggeration down when the measured relief is flat - hills
   * keep the full guide curve. Web counterpart of the native adapter's
   * mapViewRef.queryTerrainElevation effect.
   */
  const lastReliefSampleRef = useRef<{ latitude: number; longitude: number } | null>(null);
  /** The scale currently applied to the terrain style - needed to undo
   * the exaggeration baked into queryTerrainElevation's readings. */
  const appliedTerrainScaleRef = useRef(1);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !driverPosition) return;
    const last = lastReliefSampleRef.current;
    if (last && haversineDistance(driverPosition, last) < TERRAIN_RELIEF_RESAMPLE_DISTANCE_M) return;
    const elevations = reliefSamplePoints(driverPosition)
      .map((point) => map.queryTerrainElevation([point.longitude, point.latitude]))
      .filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value));
    // DEM tiles not loaded yet - leave lastReliefSampleRef unset so the
    // next fix retries instead of waiting for a 600m move.
    if (elevations.length < 5) return;
    lastReliefSampleRef.current = driverPosition;
    const reliefM = trueReliefFromMeasured(
      trimmedReliefM(elevations),
      baseExaggerationAtZoom(map.getZoom()) * appliedTerrainScaleRef.current
    );
    const scale = exaggerationScaleForRelief(reliefM);
    appliedTerrainScaleRef.current = scale;
    console.log(`[map] terrain relief ${reliefM.toFixed(0)}m -> exaggeration scale ${scale.toFixed(2)}`);
    map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: scaledExaggerationExpression(scale) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverPosition?.latitude, driverPosition?.longitude, mapReady]);

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
        { padding: 56, pitch: CRUISING_PITCH, bearing: 0, duration: 650 }
      );
    } else if (!showRangeOnMap && driverPosition && mapRef.current) {
      // fitBounds above replaces transform.padding with its own symmetric
      // value - restore the lower-third driver anchor before easing back.
      mapRef.current.setPadding(lookAheadPadding(mapRef.current));
      mapRef.current.easeTo({
        center: [driverPosition.longitude, driverPosition.latitude],
        zoom: 15.5,
        pitch: CRUISING_PITCH,
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

  /**
   * On-map marker decluttering (geo/declutterMarkers.ts) - same contract
   * as the native adapter: markers closer than one glyph-width on screen
   * group into a cluster, the most relevant marker (pinned = focused,
   * else nearest the driver) draws with a "+N" badge. Zoom comes from the
   * live map so the separation stays a fixed on-screen size.
   */
  const markerClusters = useMemo(() => {
    const pinnedIds = new Set(
      [focusedAlert?.alert_id].filter((id): id is string => Boolean(id)).map((id) => `alert:${id}`)
    );
    const zoom = mapRef.current?.getZoom() ?? 15.5;
    const items: Array<
      { id: string; latitude: number; longitude: number } & (
        | { kind: 'camera'; camera: FixedSpeedCamera }
        | { kind: 'alert'; alert: WazeAlert }
      )
    > = [
      ...mapVisibleCameras.map((camera) => ({
        id: `camera:${camera.id}`,
        kind: 'camera' as const,
        latitude: camera.position.latitude,
        longitude: camera.position.longitude,
        camera,
      })),
      ...mapRenderableAlerts.map((alert) => ({
        id: `alert:${alert.alert_id}`,
        kind: 'alert' as const,
        latitude: alert.latitude,
        longitude: alert.longitude,
        alert,
      })),
    ];
    return clusterMarkers(items, {
      separationMeters: markerSeparationMeters(zoom, driverPosition?.latitude ?? -34.9285),
      driverPosition,
      pinnedIds,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapVisibleCameras, mapRenderableAlerts, driverPosition, focusedAlert?.alert_id, mapReady]);

  /** Stage B preview lines: one GeoJSON source + a data-driven line layer
   * (colour/selected per feature) holding every candidate route at once -
   * the same visual contract as RadarMap.tsx's per-option ShapeSources.
   * setData keeps the layer live across selection changes; an empty
   * FeatureCollection clears it when the plan goes away. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const apply = () => {
      const features = routeOptions
        .filter((option) => option.route.polyline.length >= 2)
        .map((option) => ({
          type: 'Feature',
          properties: {
            color: ROUTE_OPTION_COLORS[option.id],
            selected: option.id === selectedRouteOptionId,
          },
          geometry: {
            type: 'LineString',
            coordinates: option.route.polyline.map((point) => [point.longitude, point.latitude]),
          },
        }));
      const data = { type: 'FeatureCollection', features };
      const source = map.getSource('route-options');
      if (source) {
        source.setData(data);
        return;
      }
      if (features.length === 0) return;
      const firstSymbolLayer = map
        .getStyle()
        .layers.find((layer: { type: string }) => layer.type === 'symbol');
      map.addSource('route-options', { type: 'geojson', data });
      map.addLayer(
        {
          id: 'route-options-line',
          type: 'line',
          source: 'route-options',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['case', ['get', 'selected'], 6, 4],
            'line-opacity': ['case', ['get', 'selected'], 0.95, 0.4],
          },
        },
        firstSymbolLayer ? firstSymbolLayer.id : undefined
      );
    };

    // Route options can land while the style is still loading (search
    // resolves fast on a warm cache) - hold until 'idle' instead of
    // dropping the draw.
    if (map.isStyleLoaded()) apply();
    else map.once('idle', apply);
  }, [routeOptions, selectedRouteOptionId, mapReady]);

  /** Route planning owns the camera: fit the whole candidate extent once
   * the options land (the panel owns the bottom ~half of the screen, so
   * the bottom padding keeps every line clear of it), then hand the
   * driver-follow padding/framing back when the plan clears. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (routeOptionsStatus === 'ready' && routeOptions.length > 0) {
      const coordinates = routeOptions.flatMap((option) => option.route.polyline);
      const longitudes = coordinates.map((point) => point.longitude);
      const latitudes = coordinates.map((point) => point.latitude);
      const height = map.getContainer().clientHeight;
      map.fitBounds(
        [
          [Math.min(...longitudes), Math.min(...latitudes)],
          [Math.max(...longitudes), Math.max(...latitudes)],
        ],
        {
          padding: { top: Math.round(height * 0.1), right: 48, bottom: Math.round(height * 0.45), left: 48 },
          pitch: CRUISING_PITCH,
          bearing: 0,
          duration: 700,
        }
      );
      routeOptionsWereShownRef.current = true;
    } else if (routeOptionsStatus === 'idle' && routeOptionsWereShownRef.current) {
      routeOptionsWereShownRef.current = false;
      map.setPadding(lookAheadPadding(map));
      if (driverPosition) {
        map.easeTo({
          center: [driverPosition.longitude, driverPosition.latitude],
          zoom: 15.5,
          pitch: CRUISING_PITCH,
          bearing: useTripStore.getState().driverHeadingDeg,
          duration: 650,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeOptionsStatus === 'ready', mapReady]);

  /** Stage C's committed route: one GeoJSON source + line layer, same
   * setData-keeps-it-live pattern as the route-options preview source
   * above (and the same visual contract as RadarMap.tsx's route-line
   * ShapeSource - coolBlue, 5px, rounded). An empty FeatureCollection
   * clears it when navigation ends. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const apply = () => {
      const features =
        activeRoute && activeRoute.polyline.length >= 2
          ? [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: activeRoute.polyline.map((point) => [point.longitude, point.latitude]),
                },
              },
            ]
          : [];
      const data = { type: 'FeatureCollection', features };
      const source = map.getSource('active-route');
      if (source) {
        source.setData(data);
        return;
      }
      if (features.length === 0) return;
      const firstSymbolLayer = map
        .getStyle()
        .layers.find((layer: { type: string }) => layer.type === 'symbol');
      map.addSource('active-route', { type: 'geojson', data });
      map.addLayer(
        {
          id: 'active-route-line',
          type: 'line',
          source: 'active-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': colors.navigation, 'line-width': 5, 'line-opacity': 0.9 },
        },
        firstSymbolLayer ? firstSymbolLayer.id : undefined
      );
    };

    if (map.isStyleLoaded()) apply();
    else map.once('idle', apply);
  }, [activeRoute, mapReady]);

  /** Turn-by-turn follow: while navigating, the camera tracks the snapped
   * driver position heading-up at close zoom - the web counterpart of
   * RadarMap.tsx's declarative NAVIGATING_ZOOM / driver-heading Camera
   * branch. Runs per GPS fix; the short easeTo duration blends consecutive
   * fixes into a glide instead of a series of jumps. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !isNavigating || !displayDriverPosition) return;
    // §7: nav framing = NAVIGATING_PITCH + the lower-third driver anchor.
    // transform.padding persists across easeTo, but re-assert it here so a
    // stray fitBounds (route preview, focus) can never leave the puck
    // centred mid-navigation.
    map.setPadding(lookAheadPadding(map));
    map.easeTo({
      center: [displayDriverPosition.longitude, displayDriverPosition.latitude],
      zoom: NAVIGATING_ZOOM,
      pitch: NAVIGATING_PITCH,
      bearing: useTripStore.getState().driverHeadingDeg,
      duration: 800,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNavigating, displayDriverPosition?.latitude, displayDriverPosition?.longitude, mapReady]);

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
      pitch: CRUISING_PITCH,
      bearing: useTripStore.getState().driverHeadingDeg,
      padding: lookAheadPadding({ getContainer: () => hostRef.current! }),
      attributionControl: true,
    });
    mapRef.current = map;
    setMapReady(true);
    // Debug handles so local tooling (screenshots, manual camera checks,
    // seeded demo state) can drive the map and stores without synthesising
    // gestures.
    Object.assign(window, {
      __shotgunMap: map,
      __shotgunTripStore: useTripStore,
      __shotgunRouteOptionsStore: useRouteOptionsStore,
      __shotgunNavStore: useNavigationStore,
    });
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
      Object.assign(window, {
        __shotgunMap: null,
        __shotgunTripStore: null,
        __shotgunRouteOptionsStore: null,
        __shotgunNavStore: null,
      });
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

    if (displayDriverPosition) {
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
          .setLngLat([displayDriverPosition.longitude, displayDriverPosition.latitude])
          .addTo(map)
      );
    }

    // "+N" badge for a decluttered cluster's primary marker - the count of
    // the other markers sharing that spot (geo/declutterMarkers.ts).
    const makeClusterBadge = (extraCount: number) => {
      const badge = document.createElement('span');
      badge.textContent = `+${extraCount}`;
      Object.assign(badge.style, {
        position: 'absolute',
        top: '-6px',
        right: '-8px',
        minWidth: '18px',
        height: '18px',
        padding: '0 3px',
        boxSizing: 'border-box',
        borderRadius: '999px',
        background: colors.accent,
        color: colors.background,
        font: `700 11px ${typography.fontFamily.display}, Arial, sans-serif`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      });
      return badge;
    };

    for (const cluster of markerClusters) {
      const primary = cluster.primary;
      const extraCount = cluster.members.length - 1;
      if (primary.kind === 'camera') {
      const fixedCamera = primary.camera;
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
      if (extraCount > 0) cameraMarker.append(makeClusterBadge(extraCount));
      markersRef.current.push(
        // Icons are centred on their coordinate - not bottom-anchored:
        // these are badges, not pins, so a bottom anchor displaces the
        // icon half its height up-screen, which reads as metres of
        // ground drift toward whatever is north once zoomed out.
        new mapboxgl.Marker({ element: cameraMarker, anchor: 'center' })
          .setLngLat([fixedCamera.position.longitude, fixedCamera.position.latitude])
          .addTo(map)
      );
      } else {
      const alert = primary.alert;
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
      // position:relative so the cluster badge (and the police light-bar
      // spans above) resolve against the marker itself.
      marker.style.position = 'relative';
      if (extraCount > 0) marker.append(makeClusterBadge(extraCount));
      const reportMarker = new mapboxgl.Marker({ element: marker, anchor: 'center' })
        .setLngLat([alert.longitude, alert.latitude])
        .setPopup(new mapboxgl.Popup({ offset: 22 }).setText(`${meta.label} · ${alert.street ?? alert.city ?? 'Location attached'} · Reported ${Math.max(0, Math.round((now - Date.parse(alert.publish_datetime_utc)) / 60000))} min ago${alert.description ? ` · ${alert.description}` : ''}`))
        .addTo(map);
      if (focusedAlert?.alert_id === alert.alert_id) reportMarker.togglePopup();
      markersRef.current.push(reportMarker);
      }
    }
  }, [markerClusters, displayDriverPosition, focusedAlert?.alert_id, now]);

  useEffect(() => {
    const map = mapRef.current;
    // Route planning and navigation both own the camera - a focused alert
    // must not steal the route-extent fit while the options panel is up,
    // nor pull the camera off the driver mid-navigation.
    if (!map || !focusedAlert || routeOptionsStatus !== 'idle' || isNavigating) return;

    if (focusTransitionTimeoutRef.current !== null) {
      clearTimeout(focusTransitionTimeoutRef.current);
    }

    if (driverPosition) {
      const bounds: [[number, number], [number, number]] = [
        [Math.min(driverPosition.longitude, focusedAlert.longitude), Math.min(driverPosition.latitude, focusedAlert.latitude)],
        [Math.max(driverPosition.longitude, focusedAlert.longitude), Math.max(driverPosition.latitude, focusedAlert.latitude)],
      ];
      map.fitBounds(bounds, { padding: 72, pitch: CRUISING_PITCH, bearing: 0, duration: 400 });
      focusTransitionTimeoutRef.current = setTimeout(() => {
        map.flyTo({ center: [focusedAlert.longitude, focusedAlert.latitude], zoom: 16, pitch: CRUISING_PITCH, bearing: 0, duration: 500 });
        focusTransitionTimeoutRef.current = null;
      }, 400);

      return () => {
        if (focusTransitionTimeoutRef.current !== null) {
          clearTimeout(focusTransitionTimeoutRef.current);
          focusTransitionTimeoutRef.current = null;
        }
      };
    }

    map.flyTo({ center: [focusedAlert.longitude, focusedAlert.latitude], zoom: 16, pitch: CRUISING_PITCH, bearing: 0, duration: 500 });
  }, [focusedAlert?.alert_id, routeOptionsStatus, isNavigating]);

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
        <GlassView intensity={35} dim={0.45} pointerEvents="none" style={[styles.rangeLabelBadge, { top: topOverlayBottom + spacing.xs }]} accessible accessibilityLabel={`${formatCompactDistance(announceDistanceMeters)} notification range`}>
          <Text style={styles.rangeLabelText}>
            {formatCompactDistance(announceDistanceMeters).replace(/km$/, ' KM').replace(/m$/, ' M')} NOTIFICATION AREA
          </Text>
        </GlassView>
      ) : null}
      {/* The paired speed sign (design reference Im52.png): a left-edge
          capsule, vertically centred near the driver rather than parked
          in a bottom corner. Read-only - never eats a map gesture. */}
      <View style={[styles.speedSignWrap, { left: spacing.sm + insets.left }]} pointerEvents="none">
        <Speedometer />
      </View>
      {/* Stage C's next-turn banner lives in DriveScreen's top overlay
          panel now (flow layout in the ModeSwitch's slot while
          navigating) - nothing map-internal to render here. */}
      <View
        style={[
          styles.mapControls,
          { top: topOverlayBottom + spacing.sm, right: spacing.sm + insets.right },
        ]}
      >
        <Pressable
          style={[styles.recenterButton, !driverPosition && styles.recenterButtonDisabled]}
          onPress={() => {
            if (!driverPosition || !mapRef.current) return;
            // Recentering only returns the camera to driver-follow - the
            // SHOW RANGE ON MAP setting (and its badge) stays untouched.
            // While navigating the target is the nav view itself (snapped
            // position at turn-by-turn zoom), not the cruising framing.
            const target = displayDriverPosition ?? driverPosition;
            mapRef.current.setPadding(lookAheadPadding(mapRef.current));
            mapRef.current.easeTo({
              center: [target.longitude, target.latitude],
              zoom: isNavigating ? NAVIGATING_ZOOM : 15.5,
              pitch: isNavigating ? NAVIGATING_PITCH : CRUISING_PITCH,
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
    // `left` comes from the safe-area inset at the usage site - edge
    // clearance matches ScreenContainer's inset pattern, not a fixed
    // pixel offset that lands under a landscape notch.
    top: '55%',
  },
  rangeLabelBadge: {
    position: 'absolute',
    alignSelf: 'center',
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
    // `top` comes from the measured topOverlayBottom prop and `right` from
    // the safe-area inset at the usage site - the controls column must sit
    // below DriveScreen's top overlay panel (taller or shorter depending on
    // mode) and clear of edge notches.
    // site - it must sit below DriveScreen's top overlay panel, which is
    // taller or shorter depending on mode (mode switch vs maneuver banner).
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
