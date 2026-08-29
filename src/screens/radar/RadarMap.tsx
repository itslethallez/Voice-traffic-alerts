import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WazeAlert } from '../../api/waze/types';
import { env } from '../../config/env';
import type { FixedSpeedCamera } from '../../data/fixedSpeedCameras';
import { selectClosestOnPathAlert } from '../../engine/selectClosestOnPathAlert';
import { compassDirection } from '../../geo/bearing';
import { haversineDistance, midpoint } from '../../geo/distance';
import { MAX_ZOOM, MIN_ZOOM } from '../../geo/mercatorZoom';
import type { GeoPoint } from '../../geo/types';
import { announcementLocation } from '../../speech/formatAnnouncement';
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

/** Used only until the first GPS fix arrives, when there's no latitude yet
 * to compute a to-scale zoom from - matches the existing "no center
 * coordinate until driverPosition exists" fallback below. Matches
 * DEFAULT_CLOSE_ZOOM so the map doesn't visibly jump zoom level the moment
 * the first fix lands. */
const DEFAULT_ZOOM = 13;
/**
 * Two-zone layout (Step 12/13 rework): the map's default view centers on
 * the driver, decoupled from announceDistanceMeters entirely - it no
 * longer tours out to a wide survey. The old awareness rings, which
 * visualised the announce radius to scale, are gone along with the wide
 * default zoom they depended on. Widened from 16 to 13 (user feedback: the
 * original close, ~1-2 block view didn't give enough surrounding-road
 * context at a glance).
 */
const DEFAULT_CLOSE_ZOOM = 13;
/** Fixed zoom for a focused alert (Step 12 #25) - close enough to read the
 * marker clearly, not derived from announceDistanceMeters since a focused
 * view isn't about the driver's awareness radius. */
const FOCUSED_ALERT_ZOOM = 16;

/**
 * Decorative "actively scanning" cue, reinstated on top of the map (not
 * replacing it, and not tied to any real-world distance the way the old
 * pre-two-zone rings were - re-coupling ring size to announceDistanceMeters
 * would recouple zoom to it too, undoing the two-zone rework). Same fixed
 * pixel sizes the old rings used, before they were removed in the two-zone
 * rework - reused here as a reasonable, already-designed-for-this-screen
 * starting point. A deliberate, scoped exception to the Instrument
 * redesign's "no accent colour" rule (theme/colors.ts) - confirmed with
 * the user directly rather than assumed. HUD face colour pass adds a
 * third, middle ring and moves the colour from `colors.accent` to
 * `hud.accent`.
 */
const RADAR_RING_OUTER_SIZE = 236;
const RADAR_RING_MID_SIZE = 178;
const RADAR_RING_INNER_SIZE = 120;
const RADAR_RING_PULSE_DURATION_MS = 1000;

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
/** How much further out than the more-zoomed-in of the two endpoints the
 * pull-back step goes. */
const TRANSITION_ZOOM_OUT_DELTA = 2;

interface RadarMapProps {
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
}

export function RadarMap({ focusedAlert = null, now = Date.now() }: RadarMapProps) {
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
    const ownReports = visibleManualReportAlerts(manualReports, driverPosition, Date.now(), announceDistanceMeters).filter(
      (alert) => enabledTypes.has(alert.type)
    );
    const nearby = visibleNearbyReportAlerts(nearbyReports, driverPosition, Date.now(), announceDistanceMeters).filter(
      (alert) => enabledTypes.has(alert.type)
    );
    return [...waze, ...ownReports, ...nearby];
  }, [visibleAlerts, manualReports, nearbyReports, enabledTypes, driverPosition, announceDistanceMeters]);

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

  /** Loops continuously for the lifetime of this component - a glanceable
   * "listening" cue, not driven by any data, so it never needs resetting. */
  const ringPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPulse, {
          toValue: 1,
          duration: RADAR_RING_PULSE_DURATION_MS,
          useNativeDriver: true,
        }),
        Animated.timing(ringPulse, {
          toValue: 0,
          duration: RADAR_RING_PULSE_DURATION_MS,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [ringPulse]);
  const ringScale = ringPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const ringOpacity = ringPulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.15] });

  const cameraRef = useRef<ComponentRef<MapboxModule['Camera']> | null>(null);
  /** Skips the very first run - there's no meaningful "from" state on
   * mount, and the declarative Camera props below already center
   * correctly on first render without needing a transition. */
  const hasRunFocusTransitionEffectRef = useRef(false);
  const focusTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusKey = displayFocus?.alert_id ?? null;
  useEffect(() => {
    const isFirstRun = !hasRunFocusTransitionEffectRef.current;
    hasRunFocusTransitionEffectRef.current = true;
    if (isFirstRun || !cameraRef.current || !driverPosition) return;

    const targetPoint: GeoPoint = displayFocus
      ? { latitude: displayFocus.latitude, longitude: displayFocus.longitude }
      : driverPosition;
    const targetZoom = displayFocus ? FOCUSED_ALERT_ZOOM : DEFAULT_CLOSE_ZOOM;
    const pulledBackZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom - TRANSITION_ZOOM_OUT_DELTA));
    const pivot = midpoint(driverPosition, targetPoint);

    cameraRef.current.setCamera({
      centerCoordinate: [pivot.longitude, pivot.latitude],
      zoomLevel: pulledBackZoom,
      animationDuration: TRANSITION_ZOOM_OUT_DURATION_MS,
      animationMode: 'easeTo',
    });

    if (focusTransitionTimeoutRef.current !== null) {
      clearTimeout(focusTransitionTimeoutRef.current);
    }
    focusTransitionTimeoutRef.current = setTimeout(() => {
      cameraRef.current?.setCamera({
        centerCoordinate: [targetPoint.longitude, targetPoint.latitude],
        zoomLevel: targetZoom,
        heading: displayFocus ? 0 : driverHeadingDeg,
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
    // Deliberately keyed on focusKey alone - driverPosition/driverHeadingDeg
    // are read live inside for whichever point in time the transition
    // actually fires, not to re-trigger this effect on every ~3s position
    // tick the way the declarative Camera props below do.
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
        // Mapbox has no built-in "monochrome" stock style - Dark is the
        // closest available match to the design's near-black map ground
        // without hand-authoring a full custom style JSON, which risks a
        // blank/broken map if it's wrong and can't be visually verified in
        // this environment. Documented fidelity gap - see the redesign plan.
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
          ref={cameraRef}
          centerCoordinate={
            displayFocus
              ? [displayFocus.longitude, displayFocus.latitude]
              : driverPosition
                ? [driverPosition.longitude, driverPosition.latitude]
                : undefined
          }
          heading={displayFocus ? 0 : driverHeadingDeg}
          zoomLevel={displayFocus ? FOCUSED_ALERT_ZOOM : driverPosition ? DEFAULT_CLOSE_ZOOM : DEFAULT_ZOOM}
          animationMode="easeTo"
          animationDuration={600}
        />

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

        {mapVisibleAlerts.map((alert) => (
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
            />
          </Mapbox.MarkerView>
        ))}
      </Mapbox.MapView>

      {!displayFocus ? (
        <>
          <Animated.View
            style={[styles.radarRingOuter, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
            pointerEvents="none"
          />
          <Animated.View
            style={[styles.radarRingMid, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
            pointerEvents="none"
          />
          <Animated.View
            style={[styles.radarRingInner, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
            pointerEvents="none"
          />
        </>
      ) : null}

      {displayFocus ? (
        <View style={styles.headingChip} pointerEvents="none">
          <Text style={styles.headingChipText}>
            {focusLabel ??
              `${compassDirection(driverHeadingDeg).toUpperCase()}BOUND${
                headingStreet ? ` · ${headingStreet.toUpperCase()}` : ''
              }`}
          </Text>
        </View>
      ) : closest ? (
        <ClosestReportPanel
          closest={closest}
          driverHeadingDeg={driverHeadingDeg}
          driverSpeedKmh={driverSpeedKmh}
          nowMs={now}
          nearbyReport={nearbyReportsById.get(closest.alert.alert_id)}
          onConfirm={confirmNearbyReport}
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
}: {
  alert: WazeAlert;
  driverPosition: { latitude: number; longitude: number } | null;
  /** Set only when this marker is another device's report (RadarMap's
   * nearbyReportsById lookup) - undefined for Waze's own alerts and for
   * this device's own reports, neither of which are confirmable. */
  nearbyReport?: NearbyReport;
  onConfirm?: (id: string) => void;
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
    // Just the flashing blue/red light bar - no letter, no distance chip.
    // A real police car doesn't wear a label or a range-finder, just its
    // lights; the other alert types still get the letter+distance
    // treatment since they have no equivalent "just show what it is" glyph.
    <View style={styles.policeMarker}>
      <PoliceLightBar orientation="horizontal" width={POLICE_MARKER_SIZE} height={POLICE_MARKER_HEIGHT} />
    </View>
  ) : (
    <View style={styles.alertMarker}>
      <View style={styles.alertPin}>
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
    return <View accessibilityLabel={accessibilityLabel}>{marker}</View>;
  }

  // Another device's report: tappable to confirm ("still there?"), with a
  // small chip below the usual marker showing whether this device already
  // has. Waze's own alerts and this device's own reports never reach this
  // branch (nearbyReport is only set for the map's other-devices layer).
  return (
    <Pressable
      onPress={canConfirm && onConfirm ? () => onConfirm(nearbyReport.id) : undefined}
      accessibilityRole={canConfirm ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
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
      <View style={styles.cameraPin}>
        <Text style={styles.cameraPinLetter}>S</Text>
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
const POLICE_MARKER_HEIGHT = 18;
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
  radarRingOuter: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: RADAR_RING_OUTER_SIZE,
    height: RADAR_RING_OUTER_SIZE,
    marginLeft: -RADAR_RING_OUTER_SIZE / 2,
    marginTop: -RADAR_RING_OUTER_SIZE / 2,
    borderRadius: RADAR_RING_OUTER_SIZE / 2,
    borderWidth: 1,
    borderColor: hud.accent,
  },
  radarRingMid: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: RADAR_RING_MID_SIZE,
    height: RADAR_RING_MID_SIZE,
    marginLeft: -RADAR_RING_MID_SIZE / 2,
    marginTop: -RADAR_RING_MID_SIZE / 2,
    borderRadius: RADAR_RING_MID_SIZE / 2,
    borderWidth: 1,
    borderColor: hud.accent,
  },
  radarRingInner: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: RADAR_RING_INNER_SIZE,
    height: RADAR_RING_INNER_SIZE,
    marginLeft: -RADAR_RING_INNER_SIZE / 2,
    marginTop: -RADAR_RING_INNER_SIZE / 2,
    borderRadius: RADAR_RING_INNER_SIZE / 2,
    borderWidth: 1,
    borderColor: hud.accent,
  },
  headingChip: {
    position: 'absolute',
    top: 12,
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
  alertMarker: {
    alignItems: 'flex-start',
    gap: 3,
  },
  policeMarker: {
    width: POLICE_MARKER_SIZE,
    height: POLICE_MARKER_HEIGHT,
  },
  alertPin: {
    width: ALERT_PIN_SIZE,
    height: ALERT_PIN_SIZE,
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
  cameraPin: {
    width: ALERT_PIN_SIZE,
    height: ALERT_PIN_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: ALERT_PIN_BORDER_WIDTH,
    borderColor: hud.accent,
  },
  cameraPinLetter: {
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 15,
    color: hud.accent,
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
