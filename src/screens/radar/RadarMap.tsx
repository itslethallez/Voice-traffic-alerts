import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
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
import { enabledTypesFromSettings } from '../../store/settingsDefaults';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTripStore, type NearbyReport } from '../../store/useTripStore';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { hud, instrument } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';
import { ClosestReportPanel } from './ClosestReportPanel';
import { DriverMark } from './DriverMark';
import { formatCompactDistance } from './formatCompactDistance';
import { PoliceLightBar } from './PoliceLightBar';

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

/** Temporarily hidden per user request (2026-09-04) while the "notifiable
 * area to scale" presentation is reworked; the circle's geometry/zoom-scale
 * logic below is unchanged and ready to re-enable once restyled. */
const SHOW_AWARENESS_CIRCLE = false;

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
}

type MapPresentation = 'nearest' | 'range' | 'free';

export function RadarMap({ focusedAlert = null, now = Date.now(), onSpotlightChange, minimal = false }: RadarMapProps) {
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
  const categoriesEnabled = useSettingsStore((state) => state.categoriesEnabled);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);

  /** Same enabled-categories state that already drives speech filtering
   * (engine/selectAlerts.ts, engine/selectBriefingAlerts.ts both take this
   * same enabledTypesFromSettings() result as their `enabledTypes` option)
   * - reused here, not reimplemented, so a category switched off in
   * Settings disappears from the map the same instant it stops being
   * announced, via the exact same source of truth. */
  const enabledTypes = useMemo(() => enabledTypesFromSettings(categoriesEnabled), [categoriesEnabled]);
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
   * run through enabledTypes - gated on the POLICE toggle instead, matching
   * checkSpeedCameraWarning's own gating in tripRuntime.ts (a driver who's
   * turned POLICE off has said "don't tell me about police", and a SAPOL
   * camera is police-adjacent enforcement infrastructure). Bounded to
   * announceDistanceMeters of the driver, the same "nearby and current"
   * radius the manual/nearby report layers above already use, rather than
   * every camera in the whole (statewide) dataset at once.
   */
  const mapVisibleCameras = useMemo(() => {
    if (!driverPosition || !categoriesEnabled.POLICE) return [];
    return fixedCameras.filter(
      (camera) => haversineDistance(driverPosition, camera.position) <= announceDistanceMeters
    );
  }, [fixedCameras, driverPosition, categoriesEnabled.POLICE, announceDistanceMeters]);

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
  const cameraPadding = useMemo(
    () => ({
      paddingTop: 0,
      paddingLeft: 0,
      paddingRight: 0,
      paddingBottom: showsFocusPanel ? focusPanelHeight : 0,
    }),
    [showsFocusPanel, focusPanelHeight]
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
    mapPresentation,
    driverPosition?.longitude,
    driverPosition?.latitude,
    nearestMapAlert?.longitude,
    nearestMapAlert?.latitude,
  ]);
  const cameraZoomLevel = (cameraFocus ? FOCUSED_ALERT_ZOOM : mapPresentation === 'nearest' && nearestMapAlert ? nearestAlertZoom : awarenessZoom) + zoomAdjustment;
  // Range/notify mode keeps the same locked 50-degree drive perspective; the
  // notification label and awareness zoom still communicate the configured
  // warning distance without switching the map to a flat camera.
  const cameraHeading = cameraFollowsPresentation ? (cameraFocus || mapPresentation === 'range' ? 0 : driverHeadingDeg) : undefined;

  const cameraRef = useRef<ComponentRef<MapboxModule['Camera']> | null>(null);
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
        styleURL="mapbox://styles/mapbox/navigation-night-v1"
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
        onPress={() =>
          setMapPresentation((current) => {
            setZoomAdjustment(0);
            return current === 'range' ? 'nearest' : 'range';
          })
        }
        onRegionWillChange={(event) => {
          if (event.properties.isUserInteraction) {
            setSelectedAlert(null);
            setMapPresentation('free');
          }
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

        {SHOW_AWARENESS_CIRCLE && awarenessCircle && !displayFocus ? (
          <Mapbox.ShapeSource id="awareness-circle-source" shape={awarenessCircle}>
            <Mapbox.FillLayer
              id="awareness-circle-fill"
              style={{ fillColor: hud.accent, fillOpacity: 0.08, fillAntialias: true }}
            />
            <Mapbox.LineLayer
              id="awareness-circle-outline"
              style={{ lineColor: hud.accent, lineWidth: 2, lineOpacity: 0.9 }}
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
        <View style={styles.alertDetailCard}>
          <Text style={styles.alertDetailEyebrow}>REPORTED {Math.max(0, Math.round(ageMinutesOf(selectedAlert, now)))} MIN AGO</Text>
          <Text style={styles.alertDetailTitle}>{alertTypeMeta(selectedAlert.type, selectedAlert.subtype).label.toUpperCase()}</Text>
          <Text style={styles.alertDetailMeta}>{resolveAreaName(selectedAlert) ?? ([selectedAlert.street, selectedAlert.city].filter(Boolean).join(' · ') || 'LOCATION ATTACHED')}</Text>
          <Pressable style={styles.alertDetailClose} onPress={() => setSelectedAlert(null)} accessibilityRole="button" accessibilityLabel="Close report details">
            <Text style={styles.alertDetailCloseText}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {mapPresentation === 'range' ? (
        <View style={styles.rangeLabelBadge} pointerEvents="none">
          <Text style={styles.rangeLabelText}>
            {formatCompactDistance(announceDistanceMeters).replace(/km$/, ' KM').replace(/m$/, ' M')} NOTIFICATION AREA
          </Text>
        </View>
      ) : null}

      <View style={styles.mapControls}>
        <Pressable
          style={styles.zoomButton}
          onPress={() => {
            setSelectedAlert(null);
            setZoomAdjustment((value) => Math.min(3, value + 1));
          }}
          accessibilityRole="button"
          accessibilityLabel="ZOOM IN"
          accessibilityHint="Increases the map zoom by one level"
        >
          <Text style={styles.zoomButtonGlyph}>+</Text>
          <Text style={styles.zoomButtonLabel}>IN</Text>
        </Pressable>
        <Pressable
          style={styles.zoomButton}
          onPress={() => {
            setSelectedAlert(null);
            setZoomAdjustment((value) => Math.max(-3, value - 1));
          }}
          accessibilityRole="button"
          accessibilityLabel="ZOOM OUT"
          accessibilityHint="Decreases the map zoom by one level"
        >
          <Text style={styles.zoomButtonGlyph}>−</Text>
          <Text style={styles.zoomButtonLabel}>OUT</Text>
        </Pressable>
        <Pressable
          style={styles.mapModeControl}
          onPress={() => {
            setZoomAdjustment(0);
            setMapPresentation((current) => (current === 'range' ? 'nearest' : 'range'));
          }}
          accessibilityRole="button"
          accessibilityLabel={mapPresentation === 'range' ? 'Show nearest alert' : 'SHOW WARN RANGE'}
        >
          <Text style={styles.mapModeControlText}>{mapPresentation === 'range' ? 'NEAREST' : 'RANGE'}</Text>
        </Pressable>
      </View>

      {displayFocus ? (
        <View style={styles.headingChip} pointerEvents="none">
          <Text style={styles.headingChipText}>
            {focusLabel ??
              `${compassDirection(driverHeadingDeg).toUpperCase()}BOUND${
                headingStreet ? ` · ${headingStreet.toUpperCase()}` : ''
              }`}
          </Text>
        </View>
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
        <View style={styles.headingChip} pointerEvents="none">
          <Text style={styles.headingChipText}>
            {`${compassDirection(driverHeadingDeg).toUpperCase()}BOUND${
              headingStreet ? ` · ${headingStreet.toUpperCase()}` : ''
            }`}
          </Text>
        </View>
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
      : `${baseLabel}, reported by another driver - double tap to confirm it's still there`
    : baseLabel;

  const marker = isPolice ? (
    <View style={styles.alertMarker}>
      <View style={[styles.policeSquare, isSelected && styles.selectedMarker]}>
        <PoliceLightBar orientation="horizontal" width={POLICE_MARKER_SIZE} height={POLICE_LIGHT_BAR_HEIGHT} />
        <Text style={styles.policeLetter}>P</Text>
      </View>
      {distanceMeters !== null ? (
        <View style={styles.alertDistanceChip}>
          <Text style={styles.alertDistanceText}>{formatCompactDistance(distanceMeters).replace(/km$/, ' KM')}</Text>
        </View>
      ) : null}
    </View>
  ) : (
    <View style={styles.alertMarker}>
      <View style={[styles.alertPin, { backgroundColor: meta.color }, isSelected && styles.selectedMarker]}>
        <Text style={styles.alertPinLetter}>{meta.letter}</Text>
      </View>
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

  // Another device's report: tappable to confirm ("still there?"), with a
  // small chip below the usual marker showing whether this device already
  // has. Waze's own alerts and this device's own reports never reach this
  // branch (nearbyReport is only set for the map's other-devices layer).
  return (
    <Pressable
      onPress={() => onSelect(alert)}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${accessibilityLabel}. Show details`}
    >
      {marker}
      <View style={[styles.confirmChip, nearbyReport.confirmedByThisDevice && styles.confirmChipDone]}>
        <Text style={styles.confirmChipText}>{nearbyReport.confirmedByThisDevice ? 'CONFIRMED' : 'STILL THERE?'}</Text>
      </View>
    </Pressable>
  );
}

/**
 * Deliberately visually distinct from AlertMarker's pins: an outline-only
 * badge (ink fill, no border) rather than a filled pin, so permanent
 * enforcement infrastructure doesn't read as "something is happening right
 * now" the way a live Waze/report alert does. 'S' for "speed camera" -
 * this app has no other camera type to disambiguate from (see
 * fixedSpeedCameras.ts's doc comment: PAC/Rail/MPDC types were never
 * ingested). Not tappable/confirmable - a camera is a fact, not a report -
 * so unlike AlertMarker this never wraps itself in a Pressable.
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
        <PoliceLightBar orientation="horizontal" width={FIXED_CAMERA_MARKER_SIZE} height={POLICE_LIGHT_BAR_HEIGHT} />
        <Text style={styles.cameraSquareLetter}>S</Text>
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
const ALERT_PIN_SIZE = 28;
const ALERT_PIN_BORDER_WIDTH = 2;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  unsupported: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: hud.mapGround,
    paddingHorizontal: 32,
  },
  unsupportedText: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 22,
    color: instrument.mutedOnInk,
    textAlign: 'center',
  },
  headingChip: {
    position: 'absolute',
    top: 78,
    left: 20,
    backgroundColor: hud.ground,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  headingChipText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: instrument.paper,
  },
  mapControls: {
    position: 'absolute',
    right: 12,
    top: 78,
    flexDirection: 'row',
    gap: 6,
  },
  rangeLabelBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: 78,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: hud.ground,
    borderWidth: 1,
    borderColor: hud.accent,
  },
  rangeLabelText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1,
    color: hud.accent,
  },
  alertDetailCard: {
    position: 'absolute', left: 16, right: 16, bottom: 112,
    minHeight: 92, padding: 15, paddingRight: 48, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.97)',
  },
  alertDetailEyebrow: { fontFamily: fontFamily.bold, fontSize: 9, letterSpacing: 1.2, color: '#087566' },
  alertDetailTitle: { marginTop: 4, fontFamily: fontFamily.black, fontSize: 18, color: '#07313C' },
  alertDetailMeta: { marginTop: 3, fontFamily: fontFamily.medium, fontSize: 12, color: '#5E777D' },
  alertDetailClose: {
    position: 'absolute', right: 8, top: 8, width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  alertDetailCloseText: { fontFamily: fontFamily.medium, fontSize: 24, color: '#587177' },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: hud.ground,
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
  mapModeControl: {
    minHeight: 36,
    minWidth: 58,
    alignSelf: 'center',
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: hud.ground,
    borderWidth: 1,
    borderColor: hud.accent,
    paddingHorizontal: 9,
  },
  mapModeControlText: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    letterSpacing: 1,
    color: hud.accent,
  },
  alertMarker: {
    alignItems: 'flex-start',
    gap: 3,
  },
  policeSquare: {
    width: POLICE_MARKER_SIZE,
    height: POLICE_MARKER_SIZE,
    borderRadius: 4,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: instrument.paper,
  },
  policeLetter: {
    marginTop: 1,
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 15,
    color: instrument.ink,
  },
  alertPin: {
    width: ALERT_PIN_SIZE,
    height: ALERT_PIN_SIZE,
    borderRadius: ALERT_PIN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: instrument.ink,
    borderWidth: ALERT_PIN_BORDER_WIDTH,
    borderColor: instrument.paper,
  },
  alertPinLetter: {
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 15,
    color: instrument.paper,
  },
  selectedMarker: {
    borderWidth: 3,
    borderColor: hud.accent,
    transform: [{ scale: 1.18 }],
    shadowColor: hud.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 7,
    elevation: 8,
  },
  alertDistanceChip: {
    paddingVertical: 1,
    paddingHorizontal: 4,
    backgroundColor: instrument.ink,
  },
  alertDistanceText: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: instrument.paper,
  },
  cameraMarker: {
    alignItems: 'flex-start',
    gap: 3,
  },
  cameraSquare: {
    width: FIXED_CAMERA_MARKER_SIZE,
    height: FIXED_CAMERA_MARKER_SIZE,
    borderRadius: 4,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: instrument.ink,
  },
  cameraSquareLetter: {
    marginTop: 1,
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 15,
    color: instrument.paper,
  },
  cameraDistanceChip: {
    paddingVertical: 1,
    paddingHorizontal: 4,
    backgroundColor: hud.ground,
  },
  confirmChip: {
    marginTop: 3,
    alignSelf: 'flex-start',
    paddingVertical: 2,
    paddingHorizontal: 5,
    backgroundColor: hud.accent,
  },
  confirmChipDone: {
    backgroundColor: instrument.ink,
    opacity: 0.7,
  },
  confirmChipText: {
    fontFamily: fontFamily.bold,
    fontSize: 9,
    letterSpacing: 0.5,
    color: instrument.paper,
  },
});
