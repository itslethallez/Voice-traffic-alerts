import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Camera as CameraIcon, LocateFixed } from 'lucide-react-native';
import type { WazeAlert } from '../../api/waze/types';
import { env } from '../../config/env';
import type { FixedSpeedCamera } from '../../data/fixedSpeedCameras';
import { selectClosestOnPathAlert } from '../../engine/selectClosestOnPathAlert';
import { compassDirection } from '../../geo/bearing';
import { haversineDistance, midpoint } from '../../geo/distance';
import { MAX_ZOOM, MIN_ZOOM } from '../../geo/mercatorZoom';
import { awarenessCircleCoordinates, awarenessZoomLevel } from '../../geo/mapScale';
import { nearestAlertToDriver } from '../../geo/nearestAlert';
import { announcementLocation, resolveAreaName } from '../../speech/formatAnnouncement';
import { visibleManualReportAlerts } from '../../store/manualReportAlert';
import { visibleNearbyReportAlerts } from '../../store/nearbyReportAlert';
import { MAP_STYLE_JSON, MAP_STYLE_URL } from '../../config/mapStyle';
import { visibleTypesFromFilters } from '../../store/settingsDefaults';
import { useNavigationStore } from '../../store/useNavigationStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTripStore, type NearbyReport } from '../../store/useTripStore';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { alpha, colors, map3d, radii, spacing, typography } from '../../theme/tokens';
import type {
  AtmosphereLayerStyle,
  FillExtrusionLayerStyle,
  HillshadeLayerStyle,
  TerrainLayerStyle,
} from '@rnmapbox/maps';
import { GlassView } from '../../components/base/GlassView';
import { ClosestReportPanel } from './ClosestReportPanel';
import { DriverMark } from './DriverMark';
import { formatCompactDistance } from './formatCompactDistance';
import { ManeuverBanner } from './ManeuverBanner';
import { PoliceLightBar } from './PoliceLightBar';
import { Speedometer } from './Speedometer';

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

/**
 * Default until the first GPS fix or map layout is known. Once both are
 * available the camera uses awarenessZoomLevel(), derived from the active
 * "Warn me from" radius instead.
 */
const DEFAULT_ZOOM = 13;
/** The warning circle's diameter occupies this fraction of the shorter map
 * edge. Keeping a margin means the circle is fully readable even above the
 * map's status overlays. */
const AWARENESS_CIRCLE_VIEWPORT_COVERAGE = 0.78;
/** Fixed zoom for a focused alert; the awareness view resumes when focus ends. */
const FOCUSED_ALERT_ZOOM = 16;
const AWARENESS_CIRCLE_SEGMENTS = 48;
/** Fixed heading-up follow zoom while navigating - tighter than the
 * awareness/nearest views, matching a normal turn-by-turn app's driving
 * view rather than this app's usual wide situational-awareness framing. */
const NAVIGATING_ZOOM = 17;

/**
 * 3D design guide §2: in Cruising's driver-following view the vehicle mark
 * anchors in the lower third of the screen so the road ahead owns the
 * frame. Top camera padding of this fraction of the map height pushes the
 * camera's anchor point down without changing the pitch.
 */
const CRUISING_LOOK_AHEAD_PADDING_FRACTION = 0.32;
/**
 * Building extrusions start fading in at this zoom - below it the style's
 * flat building fill is enough and extrusions would only clutter the
 * wider view the driver needs.
 */
const BUILDING_EXTRUSION_MIN_ZOOM = 13;

/**
 * 3D guide §3 paint values - module constants rather than inline literals
 * so each layer's `style` prop keeps a stable reference across renders
 * (same reason cameraPadding is memoized: @rnmapbox forwards changed
 * props straight to the native style engine).
 */
const TERRAIN_3D_STYLE: TerrainLayerStyle = {
  // Stronger relief zoomed out on open/regional roads where terrain is the
  // visual character; easing off in the city where buildings take over.
  exaggeration: ['interpolate', ['linear'], ['zoom'], 10, 1.6, 14, 1.0],
};
const HILLSHADE_3D_STYLE: HillshadeLayerStyle = {
  hillshadeExaggeration: 0.25,
  hillshadeShadowColor: map3d.hillshadeShadow,
  hillshadeHighlightColor: map3d.hillshadeHighlight,
};
const BUILDINGS_3D_STYLE: FillExtrusionLayerStyle = {
  fillExtrusionColor: map3d.building,
  fillExtrusionHeight: ['interpolate', ['linear'], ['zoom'], BUILDING_EXTRUSION_MIN_ZOOM, 0, BUILDING_EXTRUSION_MIN_ZOOM + 0.5, ['get', 'height']],
  fillExtrusionBase: ['get', 'min_height'],
  fillExtrusionOpacity: 0.55,
  fillExtrusionVerticalGradient: true,
  fillExtrusionAmbientOcclusionIntensity: 0.35,
  // Sit on the DEM terrain instead of the flat plane so extrusions on
  // slopes don't float or bury.
  fillExtrusionHeightAlignment: 'terrain',
  fillExtrusionBaseAlignment: 'terrain',
};
const ATMOSPHERE_3D_STYLE: AtmosphereLayerStyle = {
  range: [1.5, 20],
  color: map3d.atmosphereHorizon,
  highColor: map3d.atmosphereHigh,
  spaceColor: map3d.atmosphereSpace,
  horizonBlend: 0.12,
  starIntensity: 0,
};

/**
 * How long the camera lingers on a genuinely-new alert's exact location
 * before returning to the close driver-following view - a brief
 * interruption, not a tour. "Genuinely new" means an alert_id not already
 * in seenAlertIds below; already-seen alerts never retrigger this, however
 * many times they're re-fetched.
 */
const NEW_ALERT_LOCATE_HOLD_MS = 3000;
/** Minimum time between one auto-locate interruption and the next, so a
 * dense stretch of road introducing several new alerts within a few polls
 * doesn't turn back into a touring loop - at most one interruption per
 * cooldown window; any other new alerts in the meantime are marked seen
 * (never revisited) but shown with no camera treatment. */
const NEW_ALERT_LOCATE_COOLDOWN_MS = 20000;

/**
 * Focus-change transition (Step 13 #4): jumping the camera straight to a
 * newly-focused alert (or back to following the driver) loses the
 * driver's sense of where that point actually is relative to them. Zoom
 * out toward a pivot between the driver and the target first, then zoom
 * into the actual target, instead of a single direct pan+zoom.
 */
const TRANSITION_ZOOM_OUT_DURATION_MS = 400;
const TRANSITION_ZOOM_IN_DURATION_MS = 500;
const FOCUS_BOUNDS_PADDING = [72, 56, 148, 56];

function ageMinutesOf(alert: WazeAlert, nowMs: number): number {
  return (nowMs - Date.parse(alert.publish_datetime_utc)) / 60_000;
}

interface RadarMapProps {
  /** Map-first mode keeps markers and focused-alert labels but removes the
   * large closest-report panel, leaving the map as the primary surface. */
  minimal?: boolean;
  /** Set by the Drive screen's alert feed (Step 12 #25) when the driver
   * taps a row - the camera centers on this alert instead of following the
   * driver for a few seconds, then the caller clears it. The only
   * deliberate zoom-to-an-alert trigger; takes priority over the
   * automatic new-alert spotlight below if both are somehow active. */
  focusedAlert?: WazeAlert | null;
  /** Drives the closest-alert focus panel's live "REPORTED {n} MIN AGO" and
   * closing-time text (Step 12 #25's `Voice Traffic Alerts - Current UI.dc.html`
   * turn 6) - passed down from DriveScreen.tsx's own 1s ticker rather than
   * this component running a second one, since only one subscriber actually
   * needs sub-render-cycle freshness. Falls back to a one-shot Date.now() if
   * omitted, which just means that display won't tick on its own. */
  now?: number;
  /** Notified whenever the auto-locate new-alert spotlight (below) starts
   * or ends - DriveScreen.tsx uses this to suppress its own `closest`
   * ledger exclusion for exactly as long as this component suppresses its
   * own focus panel, since the spotlight is internal state here that
   * DriveScreen has no other way to know about. */
  onSpotlightChange?: (active: boolean) => void;
  /** DriveScreen's own measured height for NavigationStatusBar (0 when it
   * isn't rendering, i.e. status is 'idle') - used to keep alertDetailCard
   * clear of it instead of a fixed offset tuned only for the pre-nav
   * control row. */
  navStatusBarHeight?: number;
}

type MapPresentation = 'nearest' | 'range' | 'free';

export function RadarMap({
  focusedAlert = null,
  now = Date.now(),
  onSpotlightChange,
  minimal = false,
  navStatusBarHeight = 0,
}: RadarMapProps) {
  // Start in overview mode: show the driver's travel arrow and the closest
  // visible report. A single tap switches to the exact Warn me from radius;
  // a pan or pinch leaves the camera entirely in the driver's control.
  const [mapPresentation, setMapPresentation] = useState<MapPresentation>('nearest');
  const [zoomAdjustment, setZoomAdjustment] = useState(0);
  const [selectedAlert, setSelectedAlert] = useState<WazeAlert | null>(null);
  const [settledFocusKey, setSettledFocusKey] = useState<string | null>(null);
  const driverPosition = useTripStore((state) => state.driverPosition);
  const driverHeadingDeg = useTripStore((state) => state.driverHeadingDeg);
  const driverSpeedKmh = useTripStore((state) => state.driverSpeedKmh);
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);
  const fixedCameras = useTripStore((state) => state.fixedCameras);
  const manualReports = useTripStore((state) => state.manualReports);
  const nearbyReports = useTripStore((state) => state.nearbyReports);
  const confirmNearbyReport = useTripStore((state) => state.confirmNearbyReport);
  const latestAnnouncement = useTripStore((state) => state.recentAnnouncements[0] ?? null);
  const alertTypeFilters = useSettingsStore((state) => state.alertTypeFilters);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);
  const showRangeOnMap = useSettingsStore((state) => state.showRangeOnMap);
  const toggleRangeOnMap = useSettingsStore((state) => state.toggleRangeOnMap);
  const navigationStatus = useNavigationStore((state) => state.status);
  const activeRoute = useNavigationStore((state) => state.activeRoute);
  const navCurrentStepIndex = useNavigationStore((state) => state.currentStepIndex);
  const navDistanceToNextManeuverM = useNavigationStore((state) => state.distanceToNextManeuverM);
  const isNavigating = navigationStatus === 'navigating' || navigationStatus === 'rerouting';

  /**
   * The Settings screen's SHOW RANGE ON MAP switch drives the 'range'
   * presentation now (it replaced DriveScreen's old RANGE button). Flipping
   * it on jumps to the north-up awareness-circle view; flipping it off
   * returns to driver-follow only if the camera is still in that view -
   * a 'free' pan the driver made while the ring was up is left alone
   * rather than yanked back to follow mode.
   */
  useEffect(() => {
    if (showRangeOnMap) {
      setZoomAdjustment(0);
      setMapPresentation('range');
    } else {
      setMapPresentation((current) => (current === 'range' ? 'nearest' : current));
    }
  }, [showRangeOnMap]);

  /** What the map shows: every category whose Drive-screen filter pill is
   * on. Speech is gated separately (speakableTypesFromFilters in
   * tripRuntime.ts feeds engine/selectAlerts.ts) - a voice-muted category
   * keeps its markers, and a hidden one is neither shown nor spoken. */
  const enabledTypes = useMemo(
    () => visibleTypesFromFilters(alertTypeFilters),
    [alertTypeFilters]
  );
  const mapVisibleAlerts = useMemo(() => {
    const waze = visibleAlerts.filter((alert) => enabledTypes.has(alert.type));
    // Each report's own category gates it now, not a blanket POLICE check -
    // a report can be ACCIDENT/HAZARD since the category picker (Report
    // button) shipped, so gating all of them on the POLICE toggle would hide
    // a driver's own accident/hazard reports when POLICE is off, and never
    // hide them when ACCIDENT/HAZARD themselves are off.
    // `now`, not Date.now() - DriveScreen.tsx's rawAlerts rebuilds every
    // second from its own ticking `now` state and passes it down as a prop
    // for exactly this reason; calling Date.now() here instead would only
    // re-evaluate the live-report age/distance window when this memo's
    // other deps change, not every second, so a report the ledger has
    // already aged out could linger on the map (and in `closest`/the
    // auto-locate spotlight below) until something unrelated re-renders it.
    const ownReports = visibleManualReportAlerts(manualReports, driverPosition, now, announceDistanceMeters).filter(
      (alert) => enabledTypes.has(alert.type)
    );
    const nearby = visibleNearbyReportAlerts(nearbyReports, driverPosition, now, announceDistanceMeters).filter(
      (alert) => enabledTypes.has(alert.type)
    );
    return [...waze, ...ownReports, ...nearby];
  }, [visibleAlerts, manualReports, nearbyReports, enabledTypes, driverPosition, announceDistanceMeters, now]);

  /** A SHOW ON MAP target can have just fallen outside the current poll or
   * category-filtered marker set. Keep one explicit target marker alive so
   * the camera never flies to an anonymous point. */
  const mapRenderableAlerts = useMemo(() => {
    if (!focusedAlert || mapVisibleAlerts.some((alert) => alert.alert_id === focusedAlert.alert_id)) {
      return mapVisibleAlerts;
    }
    return [...mapVisibleAlerts, focusedAlert];
  }, [mapVisibleAlerts, focusedAlert]);

  // Presentation changes dismiss transient report detail UI. A newly supplied
  // SHOW ON MAP target, however, is selected and opens its own detail card.
  useEffect(() => {
    setSelectedAlert(null);
    setSettledFocusKey(null);
  }, [mapPresentation]);
  useEffect(() => {
    setSelectedAlert(focusedAlert);
  }, [focusedAlert?.alert_id]);

  // The map is intentionally broader than TTS: it shows the nearest visible
  // Police / Accident / Hazard (or other enabled alert) even if it is not on
  // the driver's route. Speech remains gated by range and travel direction in
  // selectAnnounceableAlerts().
  const nearestMapAlert = useMemo(
    () => nearestAlertToDriver(mapVisibleAlerts, driverPosition),
    [mapVisibleAlerts, driverPosition]
  );

  /**
   * Fixed speed cameras (SAPOL data via the central database, or the
   * bundled fallback - tripRuntime.ts's getActiveFixedCameras) as their own
   * map layer, distinct from mapVisibleAlerts above: a camera is permanent
   * infrastructure, not a live Waze/report alert, so it has no `type` to
   * run through enabledTypes - gated on the fixed_camera filter pill
   * instead, matching checkSpeedCameraWarning's own gating in
   * tripRuntime.ts (a driver who's hidden fixed cameras has said "don't
   * show me cameras"). Bounded to announceDistanceMeters of the driver,
   * the same "nearby and current" radius the manual/nearby report layers
   * above already use, rather than every camera in the whole (statewide)
   * dataset at once.
   */
  const mapVisibleCameras = useMemo(() => {
    if (!driverPosition || !alertTypeFilters.fixed_camera) return [];
    return fixedCameras.filter(
      (camera) => haversineDistance(driverPosition, camera.position) <= announceDistanceMeters
    );
  }, [fixedCameras, driverPosition, alertTypeFilters.fixed_camera, announceDistanceMeters]);

  const nearbyReportsById = useMemo(() => new Map(nearbyReports.map((report) => [report.id, report])), [nearbyReports]);

  /**
   * Auto-locate for genuinely new alerts (two-zone layout rework): briefly
   * spotlights an alert the driver hasn't seen this session, then returns
   * to the close view - never a repeating tour. `seenAlertIds` is
   * deliberately never cleared (not reset per-trip) - tied to this
   * component's own mount lifetime, which per App.tsx's permanent-mount
   * pattern is effectively the whole app session.
   */
  const seenAlertIdsRef = useRef<Set<string>>(new Set());
  const lastLocateAtRef = useRef(0);
  const [newAlertSpotlight, setNewAlertSpotlight] = useState<WazeAlert | null>(null);
  const newAlertClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const newlyArrived = mapVisibleAlerts.filter((alert) => !seenAlertIdsRef.current.has(alert.alert_id));
    if (newlyArrived.length === 0) return;

    for (const alert of newlyArrived) {
      seenAlertIdsRef.current.add(alert.alert_id);
    }

    const alreadySpotlighting = newAlertClearTimeoutRef.current !== null;
    const cooledDown = Date.now() - lastLocateAtRef.current >= NEW_ALERT_LOCATE_COOLDOWN_MS;
    if (alreadySpotlighting || !cooledDown || !driverPosition) return;

    const nearest = newlyArrived.reduce((closest, alert) => {
      const alertPos = { latitude: alert.latitude, longitude: alert.longitude };
      const closestPos = { latitude: closest.latitude, longitude: closest.longitude };
      return haversineDistance(driverPosition, alertPos) < haversineDistance(driverPosition, closestPos)
        ? alert
        : closest;
    });

    lastLocateAtRef.current = Date.now();
    setNewAlertSpotlight(nearest);
    newAlertClearTimeoutRef.current = setTimeout(() => {
      setNewAlertSpotlight(null);
      newAlertClearTimeoutRef.current = null;
    }, NEW_ALERT_LOCATE_HOLD_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapVisibleAlerts]);
  useEffect(
    () => () => {
      if (newAlertClearTimeoutRef.current !== null) clearTimeout(newAlertClearTimeoutRef.current);
    },
    []
  );
  // Only newAlertSpotlight, not the full displayFocus below - focusedAlert
  // is DriveScreen's own state already, so it has no need to be told about
  // itself; it's newAlertSpotlight (private to this component) that it
  // otherwise has no way to know about.
  useEffect(() => {
    onSpotlightChange?.(newAlertSpotlight !== null);
  }, [newAlertSpotlight, onSpotlightChange]);

  const displayFocus = focusedAlert ?? newAlertSpotlight;

  /**
   * Closest-alert focus panel (`Voice Traffic Alerts - Current UI.dc.html`
   * turn 6) - the same `closest` value DriveScreen.tsx's "ALSO AHEAD"
   * ledger uses to exclude this alert from its own list, computed
   * independently there from the same unified alert set so both agree
   * without one passing the other props. null (falls back to the plain
   * compass heading chip below) whenever there's no driver position yet,
   * or nothing within the announce distance window - and deliberately
   * suppressed while displayFocus (tap-to-focus or the new-alert
   * spotlight) is active, so this never fights that feature's own
   * heading-chip override for the same screen real estate.
   */
  const closest = useMemo(() => {
    if (!driverPosition || displayFocus) return null;
    return selectClosestOnPathAlert(mapVisibleAlerts, driverPosition, driverHeadingDeg, announceDistanceMeters);
  }, [driverPosition, displayFocus, mapVisibleAlerts, driverHeadingDeg, announceDistanceMeters]);

  /** The Mapbox viewport must be measured at runtime: a zoom that makes a
   * five-kilometre circle fit a compact phone map would be wrong on a tablet
   * or after an orientation change. */
  const [mapViewport, setMapViewport] = useState({ width: 0, height: 0 });
  const handleMapLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setMapViewport((current) => (current.width === width && current.height === height ? current : { width, height }));
  };

  const awarenessCircle = useMemo(() => {
    if (!driverPosition) return null;
    const coordinates = awarenessCircleCoordinates(driverPosition, announceDistanceMeters, AWARENESS_CIRCLE_SEGMENTS);
    if (coordinates.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [coordinates] },
    };
  }, [driverPosition?.latitude, driverPosition?.longitude, announceDistanceMeters]);

  /** The active navigation route as a GeoJSON LineString - converted from
   * useNavigationStore's GeoPoint[] polyline (already [lat,lon]) back to
   * Mapbox's own [lon,lat] coordinate order once here. */
  const routeLine = useMemo(() => {
    if (!activeRoute || activeRoute.polyline.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: activeRoute.polyline.map((point) => [point.longitude, point.latitude]),
      },
    };
  }, [activeRoute]);

  const awarenessZoom = useMemo(() => {
    if (!driverPosition || mapViewport.width <= 0 || mapViewport.height <= 0) return DEFAULT_ZOOM;
    return awarenessZoomLevel({
      latitude: driverPosition.latitude,
      radiusMeters: announceDistanceMeters,
      viewportWidth: mapViewport.width,
      viewportHeight: mapViewport.height,
      coverage: AWARENESS_CIRCLE_VIEWPORT_COVERAGE,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
    });
  }, [driverPosition?.latitude, announceDistanceMeters, mapViewport.width, mapViewport.height]);

  /** An overview uses the actual distance between driver and closest marker,
   * so both stay visible rather than showing an arbitrary fixed zoom. */
  const nearestAlertZoom = useMemo(() => {
    if (!driverPosition || !nearestMapAlert || mapViewport.width <= 0 || mapViewport.height <= 0) return awarenessZoom;
    const distanceMeters = haversineDistance(driverPosition, nearestMapAlert);
    return awarenessZoomLevel({
      latitude: driverPosition.latitude,
      radiusMeters: Math.max(distanceMeters / 2, 1),
      viewportWidth: mapViewport.width,
      viewportHeight: mapViewport.height,
      coverage: AWARENESS_CIRCLE_VIEWPORT_COVERAGE,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
    });
  }, [driverPosition, nearestMapAlert, mapViewport.width, mapViewport.height, awarenessZoom]);

  /**
   * The closest-alert focus panel's actually-rendered height (either
   * variant - full on-path panel or the stood-down quiet line), reported up
   * via ClosestReportPanel's onLayout - used below to pad the map Camera so
   * the driver mark sits clear of the panel instead of centred underneath
   * it (6a/6b: "sits at 34% of map height so it clears the focus panel").
   * Measured rather than hardcoded since the two panel states differ in
   * height.
   */
  const [focusPanelHeight, setFocusPanelHeight] = useState(0);
  const showsFocusPanel = !minimal && closest !== null && !displayFocus;
  /** ManeuverBanner's actually-rendered height, reported the same way as
   * focusPanelHeight above - lets mapControls (the zoom/recenter column)
   * shift down to clear a two-line turn instruction instead of assuming a
   * fixed height it could grow past. 0 whenever the banner isn't showing. */
  const [maneuverBannerHeight, setManeuverBannerHeight] = useState(0);
  /**
   * @rnmapbox/maps's Camera re-issues its native setCamera command whenever
   * this `padding` object's *reference* changes (its own internal
   * useEffect lists `padding` directly in its deps, not a deep-equals) -
   * a fresh `{...}` literal here every render would retrigger that 600ms
   * ease animation on every one of RadarMap's renders, including the
   * once-a-second re-render driven by DriveScreen's `now` ticker, even
   * when the actual padding hasn't changed. Memoized on the primitive
   * inputs (not `closest` itself, which is a new object every render
   * since it's downstream of that same `now` tick) so the reference only
   * changes when the padding should actually change.
   */
  /** Cruising gets the lower-third vehicle anchor from the 3D guide - in
   * 'nearest' (driver-following) and kept in 'free' so the padding doesn't
   * ease away under the driver right after their own pan gesture. Suspended
   * in 'range' (the awareness circle keeps its centred framing), while an
   * alert is focused, and while navigating - Navigate's own framing is
   * untouched this pass. */
  const cruisingLookAhead =
    mapPresentation !== 'range' && !isNavigating && displayFocus === null;
  const cameraPadding = useMemo(
    () => ({
      paddingTop: cruisingLookAhead
        ? Math.round(mapViewport.height * CRUISING_LOOK_AHEAD_PADDING_FRACTION)
        : 0,
      paddingLeft: 0,
      paddingRight: 0,
      paddingBottom: showsFocusPanel ? focusPanelHeight : 0,
    }),
    [cruisingLookAhead, mapViewport.height, showsFocusPanel, focusPanelHeight]
  );

  /** Camera targets are declarative only while Shotgun is presenting one of
   * its two useful automatic views. Once the driver pans or pinches, omit
   * them so a GPS update never snaps the map away from their exploration. */
  const cameraFollowsPresentation = mapPresentation !== 'free';
  const focusKey = displayFocus?.alert_id ?? null;
  /** Do not hand the declarative Camera the focused coordinate until the
   * imperative bounds-fit has completed; otherwise its child effect can jump
   * straight to zoom 16 before RadarMap establishes driver-to-target context. */
  const cameraFocus = displayFocus && settledFocusKey === focusKey ? displayFocus : null;
  const cameraCenterCoordinate = useMemo<[number, number] | undefined>(() => {
    if (!cameraFollowsPresentation) return undefined;
    if (cameraFocus) return [cameraFocus.longitude, cameraFocus.latitude];
    // Navigating always centers exactly on the driver - unlike 'nearest'
    // mode's midpoint-with-the-closest-alert framing, a turn-by-turn view
    // needs to stay centered on the driver themselves, not drift toward
    // whatever hazard happens to be nearby.
    if (isNavigating && driverPosition) return [driverPosition.longitude, driverPosition.latitude];
    if (mapPresentation === 'nearest' && driverPosition && nearestMapAlert) {
      const center = midpoint(driverPosition, nearestMapAlert);
      return [center.longitude, center.latitude];
    }
    if (driverPosition) return [driverPosition.longitude, driverPosition.latitude];
    return undefined;
  }, [
    cameraFollowsPresentation,
    cameraFocus?.longitude,
    cameraFocus?.latitude,
    isNavigating,
    mapPresentation,
    driverPosition?.longitude,
    driverPosition?.latitude,
    nearestMapAlert?.longitude,
    nearestMapAlert?.latitude,
  ]);
  const cameraZoomLevel =
    (cameraFocus
      ? FOCUSED_ALERT_ZOOM
      : isNavigating
        ? NAVIGATING_ZOOM
        : mapPresentation === 'nearest' && nearestMapAlert
          ? nearestAlertZoom
          : awarenessZoom) + zoomAdjustment;
  // Range/notify mode keeps the same locked 50-degree drive perspective; the
  // notification label and awareness zoom still communicate the configured
  // warning distance without switching the map to a flat camera. Navigating
  // always follows the driver's heading (heading-up) regardless of
  // mapPresentation - a turn-by-turn view has to rotate with the driver,
  // not sit north-up the way range mode deliberately does.
  const cameraHeading = !cameraFollowsPresentation
    ? undefined
    : cameraFocus
      ? 0
      : isNavigating
        ? driverHeadingDeg
        : mapPresentation === 'range'
          ? 0
          : driverHeadingDeg;

  const cameraRef = useRef<ComponentRef<MapboxModule['Camera']> | null>(null);
  /** Tracks the map's actual live zoom (from Mapbox's own onCameraChanged),
   * independent of `cameraZoomLevel` below - that value only reflects the
   * declarative nearest/range presets and goes unused while the camera is
   * in 'free' mode (a user pan/pinch), which previously left the ZOOM
   * IN/OUT buttons with nothing to act on once the driver left those two
   * presets. This ref is what those buttons nudge via cameraRef.zoomTo in
   * free mode instead. */
  const liveZoomRef = useRef(DEFAULT_ZOOM);
  const focusTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (focusTransitionTimeoutRef.current !== null) {
      clearTimeout(focusTransitionTimeoutRef.current);
      focusTransitionTimeoutRef.current = null;
    }

    if (!displayFocus) {
      setSettledFocusKey(null);
      return;
    }
    if (!cameraRef.current || !driverPosition) {
      setSettledFocusKey(focusKey);
      return;
    }

    const targetCoordinate: [number, number] = [displayFocus.longitude, displayFocus.latitude];
    const northEast: [number, number] = [
      Math.max(driverPosition.longitude, displayFocus.longitude),
      Math.max(driverPosition.latitude, displayFocus.latitude),
    ];
    const southWest: [number, number] = [
      Math.min(driverPosition.longitude, displayFocus.longitude),
      Math.min(driverPosition.latitude, displayFocus.latitude),
    ];

    cameraRef.current.fitBounds(
      northEast,
      southWest,
      FOCUS_BOUNDS_PADDING,
      TRANSITION_ZOOM_OUT_DURATION_MS
    );

    focusTransitionTimeoutRef.current = setTimeout(() => {
      setSettledFocusKey(focusKey);
      cameraRef.current?.setCamera({
        centerCoordinate: targetCoordinate,
        zoomLevel: FOCUSED_ALERT_ZOOM,
        heading: 0,
        animationDuration: TRANSITION_ZOOM_IN_DURATION_MS,
        animationMode: 'easeTo',
      });
      focusTransitionTimeoutRef.current = null;
    }, TRANSITION_ZOOM_OUT_DURATION_MS);

    return () => {
      if (focusTransitionTimeoutRef.current !== null) {
        clearTimeout(focusTransitionTimeoutRef.current);
        focusTransitionTimeoutRef.current = null;
      }
    };
    // Deliberately keyed on focusKey alone so GPS updates do not restart the
    // two-stage transition while it is in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  if (!Mapbox) {
    return (
      <Unsupported message="Radar map needs a rebuilt dev client with the Mapbox native module linked - it will not appear in Expo Go." />
    );
  }
  if (!env.mapboxAccessToken) {
    return <Unsupported message="Add EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN to .env to load the map." />;
  }

  const headingStreet = latestAnnouncement ? announcementLocation(latestAnnouncement.candidate).street : null;

  // When the camera is focused on a specific alert (tapped or newly
  // located), the heading chip below is replaced with this - without it,
  // the driver sees a silent zoomed-in map with no way to tell what
  // they're actually looking at. Reuses announcementLocation()'s existing
  // street/area resolution (including route-number filtering and the
  // suburb-preferring fallback) rather than re-deriving it, same pattern
  // as DriveScreen.tsx's feed rows.
  const focusLocation = displayFocus
    ? announcementLocation({
        alert: displayFocus,
        distanceMeters: 0,
        bearingDeg: 0,
        bearingDiffDeg: 0,
        ageMinutes: 0,
        driverHeadingDeg,
      })
    : null;
  const focusLabel = focusLocation
    ? [focusLocation.street, focusLocation.area, `${focusLocation.direction}bound`]
        .filter((part): part is string => Boolean(part))
        .join(' · ')
        .toUpperCase()
    : null;

  return (
    <View style={styles.root}>
      <Mapbox.MapView
        style={styles.root}
        onLayout={handleMapLayout}
        // "Shotgun Night" - bundled decluttered/repaletted copy of
        // navigation-night-v1 (see src/config/mapStyle.ts); a Studio-hosted
        // style URL via EXPO_PUBLIC_MAPBOX_STYLE_URL takes over if set.
        {...(MAP_STYLE_URL
          ? { styleURL: MAP_STYLE_URL }
          : { styleJSON: MAP_STYLE_JSON })}
        compassEnabled={false}
        scaleBarEnabled={false}
        // Mapbox's ToS require the logo + attribution control on any map
        // using their data/styling - leave both at their (enabled) default.
        //
        // The map starts with a useful alert overview but remains fully
        // explorable. onRegionWillChange releases automatic follow only for
        // a real user gesture; programmatic camera moves retain their mode.
        scrollEnabled
        zoomEnabled
        pitchEnabled
        rotateEnabled
        onPress={() => {
          // A map tap flips the same SHOW RANGE ON MAP setting the
          // Settings screen toggles - one mechanism, no divergent state.
          toggleRangeOnMap();
        }}
        onRegionWillChange={(event) => {
          if (event.properties.isUserInteraction) {
            setSelectedAlert(null);
            setMapPresentation('free');
          }
        }}
        onCameraChanged={(state) => {
          liveZoomRef.current = state.properties.zoom;
        }}
      >
        <Mapbox.Camera
          ref={cameraRef}
          centerCoordinate={cameraCenterCoordinate}
          heading={cameraHeading}
          pitch={50}
          zoomLevel={cameraFollowsPresentation ? cameraZoomLevel : undefined}
          padding={cameraPadding}
          animationMode="easeTo"
          animationDuration={600}
        />

        {/* 3D guide §3 - the world treatment. The DEM source feeds Terrain
            (shaped relief on open/regional roads), a restrained hillshade so
            hills and valleys read against the near-black base, and a subtle
            horizon atmosphere (never a bright game-like sky). */}
        <Mapbox.RasterDemSource
          id="shotgun-terrain-dem"
          url="mapbox://mapbox.mapbox-terrain-dem-v1"
          tileSize={514}
          maxZoomLevel={14}
        >
          <Mapbox.Terrain style={TERRAIN_3D_STYLE} />
          {/* belowLayerID puts the hillshade under buildings, roads and
              labels so carriageways stay the lightest thing in view. */}
          <Mapbox.HillshadeLayer
            id="shotgun-hillshade"
            belowLayerID="building-outline"
            style={HILLSHADE_3D_STYLE}
          />
          <Mapbox.Atmosphere style={ATMOSPHERE_3D_STYLE} />
        </Mapbox.RasterDemSource>

        {/* Charcoal/graphite extrusions reusing the style's own composite
            source (mapbox-streets v8) - no extra tileset is fetched.
            Inserted below the style's first symbol layer so labels and road
            names still render on top. */}
        <Mapbox.FillExtrusionLayer
          id="shotgun-3d-buildings"
          sourceID="composite"
          sourceLayerID="building"
          filter={['==', 'extrude', 'true']}
          minZoomLevel={BUILDING_EXTRUSION_MIN_ZOOM}
          maxZoomLevel={24}
          belowLayerID="turning-feature-outline-navigation"
          style={BUILDINGS_3D_STYLE}
        />

        {showRangeOnMap && awarenessCircle && !displayFocus ? (
          <Mapbox.ShapeSource id="awareness-circle-source" shape={awarenessCircle}>
            <Mapbox.FillLayer
              id="awareness-circle-fill"
              style={{ fillColor: colors.accent, fillOpacity: 0.08, fillAntialias: true }}
            />
            <Mapbox.LineLayer
              id="awareness-circle-outline"
              style={{ lineColor: colors.accent, lineWidth: 2, lineOpacity: 0.9 }}
            />
          </Mapbox.ShapeSource>
        ) : null}

        {routeLine ? (
          <Mapbox.ShapeSource id="route-line-source" shape={routeLine}>
            <Mapbox.LineLayer
              id="route-line"
              style={{ lineColor: colors.navigation, lineWidth: 5, lineOpacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
            />
          </Mapbox.ShapeSource>
        ) : null}

        {driverPosition ? (
          <Mapbox.MarkerView
            id="driver-marker"
            coordinate={[driverPosition.longitude, driverPosition.latitude]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <DriverMark />
          </Mapbox.MarkerView>
        ) : null}

        {mapVisibleCameras.map((camera) => (
          <Mapbox.MarkerView
            key={camera.id}
            coordinate={[camera.position.longitude, camera.position.latitude]}
            anchor={{ x: 0.5, y: 1 }}
          >
            <FixedCameraMarker camera={camera} driverPosition={driverPosition} />
          </Mapbox.MarkerView>
        ))}

        {mapRenderableAlerts.map((alert) => (
          <Mapbox.MarkerView
            key={alert.alert_id}
            coordinate={[alert.longitude, alert.latitude]}
            anchor={{ x: 0.5, y: 1 }}
          >
            <AlertMarker
              alert={alert}
              driverPosition={driverPosition}
              nearbyReport={nearbyReportsById.get(alert.alert_id)}
              onConfirm={confirmNearbyReport}
              onSelect={setSelectedAlert}
              isSelected={selectedAlert?.alert_id === alert.alert_id || focusedAlert?.alert_id === alert.alert_id}
            />
          </Mapbox.MarkerView>
        ))}
      </Mapbox.MapView>

      {selectedAlert ? (
        <GlassView intensity={45} dim={0.5} style={[styles.alertDetailCard, navStatusBarHeight > 0 && { bottom: 112 + navStatusBarHeight + 10 }]}>
          <Text style={styles.alertDetailEyebrow}>REPORTED {Math.max(0, Math.round(ageMinutesOf(selectedAlert, now)))} MIN AGO</Text>
          <Text style={styles.alertDetailTitle}>{alertTypeMeta(selectedAlert.type, selectedAlert.subtype).label.toUpperCase()}</Text>
          <Text style={styles.alertDetailMeta}>{resolveAreaName(selectedAlert) ?? ([selectedAlert.street, selectedAlert.city].filter(Boolean).join(' · ') || 'LOCATION ATTACHED')}</Text>
          <Pressable style={styles.alertDetailClose} onPress={() => setSelectedAlert(null)} accessibilityRole="button" accessibilityLabel="Close report details">
            <Text style={styles.alertDetailCloseText}>×</Text>
          </Pressable>
        </GlassView>
      ) : null}

      {showRangeOnMap && !displayFocus ? (
        <GlassView intensity={35} dim={0.45} style={styles.rangeLabelBadge} pointerEvents="none">
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

      <View
        style={[
          styles.mapControls,
          isNavigating && activeRoute ? { top: 78 + maneuverBannerHeight + 10 } : null,
        ]}
      >
        <Pressable
          style={[styles.recenterButton, !driverPosition && styles.recenterButtonDisabled]}
          onPress={() => {
            if (!driverPosition) return;
            setSelectedAlert(null);
            setZoomAdjustment(0);
            // 'nearest', not 'range' - recentering returns to the app's
            // default driver-centered view; the SHOW RANGE ON MAP setting
            // (and its ring) stays untouched either way.
            setMapPresentation('nearest');
            cameraRef.current?.setCamera({
              centerCoordinate: [driverPosition.longitude, driverPosition.latitude],
              zoomLevel: awarenessZoom,
              heading: driverHeadingDeg,
              pitch: 50,
              animationMode: 'easeTo',
              animationDuration: 650,
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
          onPress={() => {
            setSelectedAlert(null);
            if (cameraFollowsPresentation) {
              setZoomAdjustment((value) => Math.min(3, value + 1));
            } else {
              // Free mode (the driver has panned/pinched): the declarative
              // zoomAdjustment above has nothing to apply to, so nudge the
              // map's actual live zoom directly instead of doing nothing.
              const next = Math.min(MAX_ZOOM, liveZoomRef.current + 1);
              liveZoomRef.current = next;
              cameraRef.current?.zoomTo(next, 300);
            }
          }}
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
          onPress={() => {
            setSelectedAlert(null);
            if (cameraFollowsPresentation) {
              setZoomAdjustment((value) => Math.max(-3, value - 1));
            } else {
              const next = Math.max(MIN_ZOOM, liveZoomRef.current - 1);
              liveZoomRef.current = next;
              cameraRef.current?.zoomTo(next, 300);
            }
          }}
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

      {displayFocus ? (
        <GlassView intensity={35} dim={0.45} style={styles.headingChip} pointerEvents="none">
          <Text style={styles.headingChipText}>
            {focusLabel ??
              `${compassDirection(driverHeadingDeg).toUpperCase()}BOUND${
                headingStreet ? ` · ${headingStreet.toUpperCase()}` : ''
              }`}
          </Text>
        </GlassView>
      ) : isNavigating && activeRoute ? (
        <ManeuverBanner
          instruction={activeRoute.steps[navCurrentStepIndex + 1]?.maneuver.instruction ?? 'Arriving at destination'}
          distanceMeters={navDistanceToNextManeuverM}
          onLayout={(event) => setManeuverBannerHeight(event.nativeEvent.layout.height)}
        />
      ) : closest && !minimal ? (
        <ClosestReportPanel
          closest={closest}
          driverHeadingDeg={driverHeadingDeg}
          driverSpeedKmh={driverSpeedKmh}
          nowMs={now}
          nearbyReport={nearbyReportsById.get(closest.alert.alert_id)}
          onConfirm={confirmNearbyReport}
          onLayout={(event) => setFocusPanelHeight(event.nativeEvent.layout.height)}
        />
      ) : (
        <GlassView intensity={35} dim={0.45} style={styles.headingChip} pointerEvents="none">
          <Text style={styles.headingChipText}>
            {`${compassDirection(driverHeadingDeg).toUpperCase()}BOUND${
              headingStreet ? ` · ${headingStreet.toUpperCase()}` : ''
            }`}
          </Text>
        </GlassView>
      )}
    </View>
  );
}

function AlertMarker({
  alert,
  driverPosition,
  nearbyReport,
  onConfirm,
  onSelect,
  isSelected,
}: {
  alert: WazeAlert;
  driverPosition: { latitude: number; longitude: number } | null;
  /** Set only when this marker is another device's report (RadarMap's
   * nearbyReportsById lookup) - undefined for Waze's own alerts and for
   * this device's own reports, neither of which are confirmable. */
  nearbyReport?: NearbyReport;
  onConfirm?: (id: string) => void;
  onSelect: (alert: WazeAlert) => void;
  isSelected: boolean;
}) {
  const meta = useMemo(() => alertTypeMeta(alert.type, alert.subtype), [alert.type, alert.subtype]);
  const isPolice = alert.type === 'POLICE';
  const distanceMeters = useMemo(
    () =>
      driverPosition
        ? haversineDistance(driverPosition, { latitude: alert.latitude, longitude: alert.longitude })
        : null,
    [driverPosition, alert.latitude, alert.longitude]
  );

  const baseLabel =
    distanceMeters !== null
      ? `${meta.label} alert, ${formatCompactDistance(distanceMeters)} ahead`
      : `${meta.label} alert`;
  const canConfirm = nearbyReport !== undefined && !nearbyReport.confirmedByThisDevice;
  const accessibilityLabel = nearbyReport
    ? nearbyReport.confirmedByThisDevice
      ? `${baseLabel}, reported by another driver, confirmed`
      : `${baseLabel}, reported by another driver`
    : baseLabel;

  // Shape is the at-a-glance differentiator inside the police family -
  // all three share coolBlue, so colour alone can't tell them apart at
  // driving distance: a live sighting keeps the square + light bar it
  // already had, a scheduled mobile-camera window is a rotated tag
  // (temporary, fixed location), and permanent infrastructure is a ring.
  let shape: ReactNode;
  if (isPolice) {
    shape = (
      <View style={[styles.policeSquare, isSelected && styles.selectedMarker]}>
        <PoliceLightBar orientation="horizontal" width={POLICE_MARKER_SIZE} height={POLICE_LIGHT_BAR_HEIGHT} />
        <Text style={styles.policeLetter}>P</Text>
      </View>
    );
  } else if (alert.type === 'MOBILE_CAMERA') {
    shape = (
      <View style={[styles.cameraDiamond, isSelected && styles.selectedMarker]}>
        <Text style={styles.cameraGlyph}>{meta.letter}</Text>
      </View>
    );
  } else if (alert.type === 'FIXED_CAMERA') {
    shape = (
      <View style={[styles.cameraRing, isSelected && styles.selectedMarker]}>
        <Text style={styles.cameraRingGlyph}>{meta.letter}</Text>
      </View>
    );
  } else {
    shape = (
      <View style={[styles.alertPin, { backgroundColor: meta.color }, isSelected && styles.selectedMarker]}>
        <Text style={styles.alertPinLetter}>{meta.letter}</Text>
      </View>
    );
  }

  const marker = (
    <View style={styles.alertMarker}>
      {shape}
      {distanceMeters !== null ? (
        <View style={styles.alertDistanceChip}>
          <Text style={styles.alertDistanceText}>{formatCompactDistance(distanceMeters).replace(/km$/, ' KM')}</Text>
        </View>
      ) : null}
    </View>
  );

  if (!nearbyReport) {
    return <Pressable onPress={() => onSelect(alert)} accessibilityRole="button" accessibilityState={{ selected: isSelected }} accessibilityLabel={`${accessibilityLabel}. Show details`}>{marker}</Pressable>;
  }

  // Another device's report: the marker itself opens details like any other
  // alert; the STILL THERE? chip below it is its own separate control that
  // actually confirms the report via onConfirm - it previously shared the
  // marker's onSelect Pressable with no confirm action wired to it at all,
  // despite its label promising one ("double tap to confirm it's still
  // there"), so tapping it only ever opened the detail card.
  return (
    <View>
      <Pressable
        onPress={() => onSelect(alert)}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={`${accessibilityLabel}. Show details`}
      >
        {marker}
      </Pressable>
      <Pressable
        onPress={canConfirm ? () => onConfirm?.(alert.alert_id) : undefined}
        disabled={!canConfirm}
        style={[styles.confirmChip, nearbyReport.confirmedByThisDevice && styles.confirmChipDone]}
        accessibilityRole={canConfirm ? 'button' : undefined}
        accessibilityLabel={nearbyReport.confirmedByThisDevice ? 'Confirmed still there' : "Confirm it's still there"}
      >
        <Text style={[styles.confirmChipText, nearbyReport.confirmedByThisDevice && styles.confirmChipTextDone]}>
          {nearbyReport.confirmedByThisDevice ? 'CONFIRMED' : 'STILL THERE?'}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Deliberately visually distinct from AlertMarker's pins: a small camera
 * glyph in an ink badge, so permanent enforcement infrastructure doesn't
 * read as a live Waze/report alert. Not tappable/confirmable - a camera is a
 * fact, not a report.
 */
function FixedCameraMarker({
  camera,
  driverPosition,
}: {
  camera: FixedSpeedCamera;
  driverPosition: { latitude: number; longitude: number } | null;
}) {
  const distanceMeters = useMemo(
    () => (driverPosition ? haversineDistance(driverPosition, camera.position) : null),
    [driverPosition, camera.position]
  );

  const accessibilityLabel =
    distanceMeters !== null
      ? `Fixed speed camera, ${formatCompactDistance(distanceMeters)} ahead, ${camera.label}`
      : `Fixed speed camera, ${camera.label}`;

  return (
    <View accessibilityLabel={accessibilityLabel} style={styles.cameraMarker}>
      <View style={styles.cameraSquare}>
        <CameraIcon size={20} strokeWidth={2.2} color={colors.textPrimary} />
      </View>
      {distanceMeters !== null ? (
        <View style={styles.cameraDistanceChip}>
          <Text style={styles.alertDistanceText}>{formatCompactDistance(distanceMeters).replace(/km$/, ' KM')}</Text>
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

const POLICE_MARKER_SIZE = 34;
const FIXED_CAMERA_MARKER_SIZE = 34;
const POLICE_LIGHT_BAR_HEIGHT = 9;
const CAMERA_TAG_SIZE = 26;
const CAMERA_RING_SIZE = 30;
const CAMERA_RING_BORDER = 4;
const ALERT_PIN_SIZE = 28;
const ALERT_PIN_BORDER_WIDTH = 2;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  unsupported: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
  },
  unsupportedText: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: typography.fontSize.body,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  headingChip: {
    position: 'absolute',
    top: 78,
    left: 20,
    // §8 floating chrome: backdrop blur via GlassView.
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
  },
  headingChipText: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textPrimary,
  },
  mapControls: {
    position: 'absolute',
    right: 12,
    // Below the collapsed top chrome (logo + mode switch + filter chip ≈
    // 160) so the buttons never sit under DriveScreen's overlay panel.
    top: 196,
    flexDirection: 'column',
    gap: spacing.xs,
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
  alertDetailCard: {
    position: 'absolute', left: 16, right: 16, bottom: 112,
    minHeight: 92, padding: spacing.md, paddingRight: spacing.xxl, borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  alertDetailEyebrow: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.accent,
  },
  alertDetailTitle: {
    marginTop: spacing.xxs,
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.title,
    color: colors.textPrimary,
  },
  alertDetailMeta: {
    marginTop: spacing.xxs,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textSecondary,
  },
  alertDetailClose: {
    position: 'absolute', right: spacing.xs, top: spacing.xs, width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  alertDetailCloseText: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: typography.fontSize.title,
    color: colors.textMuted,
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
  alertMarker: {
    alignItems: 'flex-start',
    gap: spacing.xxs,
  },
  policeSquare: {
    width: POLICE_MARKER_SIZE,
    height: POLICE_MARKER_SIZE,
    borderRadius: radii.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: colors.coolBlue,
  },
  policeLetter: {
    marginTop: 1,
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.body,
    lineHeight: 15,
    color: colors.white,
  },
  cameraDiamond: {
    width: CAMERA_TAG_SIZE,
    height: CAMERA_TAG_SIZE,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.coolBlue,
    transform: [{ rotate: '45deg' }],
  },
  cameraGlyph: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.body,
    lineHeight: 15,
    color: colors.white,
    transform: [{ rotate: '-45deg' }],
  },
  cameraRing: {
    width: CAMERA_RING_SIZE,
    height: CAMERA_RING_SIZE,
    borderRadius: CAMERA_RING_SIZE / 2,
    borderWidth: CAMERA_RING_BORDER,
    borderColor: colors.coolBlue,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(colors.coolBlue, 0.25),
  },
  cameraRingGlyph: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.eyebrow,
    lineHeight: 11,
    color: colors.white,
  },
  alertPin: {
    width: ALERT_PIN_SIZE,
    height: ALERT_PIN_SIZE,
    borderRadius: ALERT_PIN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: ALERT_PIN_BORDER_WIDTH,
    borderColor: colors.white,
  },
  alertPinLetter: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.body,
    lineHeight: 15,
    color: colors.white,
  },
  selectedMarker: {
    borderWidth: 3,
    borderColor: colors.accent,
    transform: [{ scale: 1.18 }],
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 7,
    elevation: 8,
  },
  alertDistanceChip: {
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  alertDistanceText: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textPrimary,
  },
  cameraMarker: {
    alignItems: 'flex-start',
    gap: spacing.xxs,
  },
  cameraSquare: {
    width: FIXED_CAMERA_MARKER_SIZE,
    height: FIXED_CAMERA_MARKER_SIZE,
    borderRadius: radii.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  cameraDistanceChip: {
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  confirmChip: {
    marginTop: spacing.xxs,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
  },
  confirmChipDone: {
    backgroundColor: colors.surface,
    opacity: 0.7,
  },
  confirmChipText: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.charcoal,
  },
  confirmChipTextDone: {
    color: colors.textSecondary,
  },
});
