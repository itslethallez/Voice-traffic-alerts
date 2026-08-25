import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { WazeAlert } from '../../api/waze/types';
import { env } from '../../config/env';
import { compassDirection } from '../../geo/bearing';
import { haversineDistance, midpoint } from '../../geo/distance';
import { MAX_ZOOM, MIN_ZOOM, zoomForRingRadius } from '../../geo/mercatorZoom';
import type { GeoPoint } from '../../geo/types';
import { announcementLocation } from '../../speech/formatAnnouncement';
import { enabledTypesFromSettings } from '../../store/settingsDefaults';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTripStore } from '../../store/useTripStore';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { instrument } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';
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
 * coordinate until driverPosition exists" fallback below. */
const DEFAULT_ZOOM = 15;
/** Fixed screen sizes for the two concentric awareness rings
 * (design_handoff_instrument_face) - the outer ring is what the map's
 * Camera zoomLevel is chosen (via zoomForRingRadius) to represent
 * announceDistanceMeters of real-world ground distance at the driver's
 * current latitude; the inner ring is purely decorative depth, not tied to
 * any setting. */
const AWARENESS_RING_SIZE = 236;
const INNER_AWARENESS_RING_SIZE = 120;
/** Fixed zoom for a focused alert (Step 12 #25) - close enough to read the
 * marker clearly, not derived from announceDistanceMeters since a focused
 * view isn't about the driver's awareness radius. */
const FOCUSED_ALERT_ZOOM = 16;

/** How long the camera lingers on a just-spoken alert's exact location
 * before returning to the normal driver-following view - same idea as
 * FOCUSED_ALERT_ZOOM's tap-driven focus, just triggered by speech instead
 * of a tap. */
const SPOKEN_SPOTLIGHT_DURATION_MS = 6000;

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

/**
 * Minimum time the camera commits to one alert-to-alert focus target before
 * it's allowed to move to the next (Step 13 pacing fix): back-to-back
 * spotlight changes - most commonly several alerts spoken in quick
 * succession during the cold-start briefing, only BRIEFING_GAP_MS apart -
 * were retriggering the zoom-out-then-zoom-in transition above before its
 * own ~900ms (TRANSITION_ZOOM_OUT_DURATION_MS + TRANSITION_ZOOM_IN_DURATION_MS)
 * had even finished, cutting the zoom-out short mid-motion. 7s comfortably
 * covers that transition plus enough dwell time to actually read the pin.
 */
const MIN_ALERT_DWELL_MS = 7000;

interface RadarMapProps {
  /** Set by the Drive screen's alert ledger (Step 12 #25) when the driver
   * taps a row - the camera centers on this alert instead of following the
   * driver for a few seconds, then the caller clears it. */
  focusedAlert?: WazeAlert | null;
}

export function RadarMap({ focusedAlert = null }: RadarMapProps) {
  const driverPosition = useTripStore((state) => state.driverPosition);
  const driverHeadingDeg = useTripStore((state) => state.driverHeadingDeg);
  const visibleAlerts = useTripStore((state) => state.visibleAlerts);
  const latestAnnouncement = useTripStore((state) => state.recentAnnouncements[0] ?? null);
  const announceDistanceMeters = useSettingsStore((state) => state.announceDistanceMeters);
  const categoriesEnabled = useSettingsStore((state) => state.categoriesEnabled);

  /** Same enabled-categories state that already drives speech filtering
   * (engine/selectAlerts.ts, engine/selectBriefingAlerts.ts both take this
   * same enabledTypesFromSettings() result as their `enabledTypes` option)
   * - reused here, not reimplemented, so a category switched off in
   * Settings disappears from the map the same instant it stops being
   * announced, via the exact same source of truth. */
  const enabledTypes = useMemo(() => enabledTypesFromSettings(categoriesEnabled), [categoriesEnabled]);
  const mapVisibleAlerts = useMemo(
    () => visibleAlerts.filter((alert) => enabledTypes.has(alert.type)),
    [visibleAlerts, enabledTypes]
  );

  /** Auto-focus counterpart to the tap-driven `focusedAlert` prop: when an
   * alert is spoken, the driver should be able to glance down and
   * immediately see where it is, without having to tap anything. Keyed on
   * announcedAtMs (not alertId) so a proximity-reminder re-announcement of
   * the same alert re-triggers it too. An explicit tap-focus takes
   * priority if one is already active - this never overrides it. */
  const [spokenSpotlight, setSpokenSpotlight] = useState<WazeAlert | null>(null);
  /** Skips the effect's very first run after mount - DriveScreen (and this
   * map with it) unmounts whenever the driver leaves the Drive tab, so
   * remounting would otherwise immediately re-run this effect against
   * whatever recentAnnouncements[0] already is and spotlight a possibly
   * many-minutes-old alert. A timestamp-based freshness check was tried
   * here first, but announcedAtMs is set from the nowMs captured at the
   * *start* of the driver-update handler, before it awaits a poll fetch -
   * a slow poll can make a genuinely just-dispatched announcement's
   * timestamp look several seconds old by the time this effect actually
   * sees it, wrongly skipping the spotlight for a live alert. Tracking
   * "did this dependency change while already mounted" instead sidesteps
   * wall-clock timing entirely: every run after the first is necessarily a
   * genuine change. */
  const hasRunSpotlightEffectRef = useRef(false);
  useEffect(() => {
    const isFirstRunSinceMount = !hasRunSpotlightEffectRef.current;
    hasRunSpotlightEffectRef.current = true;
    if (!latestAnnouncement || isFirstRunSinceMount) return;

    setSpokenSpotlight(latestAnnouncement.candidate.alert);
    const timer = setTimeout(() => setSpokenSpotlight(null), SPOKEN_SPOTLIGHT_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestAnnouncement?.announcedAtMs]);

  const displayFocus = focusedAlert ?? spokenSpotlight;

  /**
   * Gates how often the camera is actually allowed to retarget (Step 13
   * pacing fix - see MIN_ALERT_DWELL_MS above). `displayFocus` can change
   * as often as every BRIEFING_GAP_MS during a briefing; `dwelledFocus`
   * only ever changes at most once per MIN_ALERT_DWELL_MS, coalescing any
   * faster churn onto whichever target is current once the dwell expires
   * (rather than visiting every intermediate one).
   */
  const [dwelledFocus, setDwelledFocus] = useState<WazeAlert | null>(null);
  const lastDwellAppliedAtRef = useRef(0);
  const pendingDwellTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (pendingDwellTimeoutRef.current !== null) {
      clearTimeout(pendingDwellTimeoutRef.current);
      pendingDwellTimeoutRef.current = null;
    }

    const applyNow = () => {
      lastDwellAppliedAtRef.current = Date.now();
      setDwelledFocus(displayFocus);
    };

    const remainingDwellMs = MIN_ALERT_DWELL_MS - (Date.now() - lastDwellAppliedAtRef.current);
    if (remainingDwellMs <= 0) {
      applyNow();
    } else {
      pendingDwellTimeoutRef.current = setTimeout(() => {
        pendingDwellTimeoutRef.current = null;
        applyNow();
      }, remainingDwellMs);
    }

    return () => {
      if (pendingDwellTimeoutRef.current !== null) {
        clearTimeout(pendingDwellTimeoutRef.current);
        pendingDwellTimeoutRef.current = null;
      }
    };
  }, [displayFocus]);

  const cameraRef = useRef<ComponentRef<MapboxModule['Camera']> | null>(null);
  /** Skips the very first run, same reasoning as hasRunSpotlightEffectRef
   * above - there's no meaningful "from" state on mount, and the
   * declarative Camera props below already center correctly on first
   * render without needing a transition. */
  const hasRunFocusTransitionEffectRef = useRef(false);
  const focusTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusKey = dwelledFocus?.alert_id ?? null;
  useEffect(() => {
    const isFirstRun = !hasRunFocusTransitionEffectRef.current;
    hasRunFocusTransitionEffectRef.current = true;
    if (isFirstRun || !cameraRef.current || !driverPosition) return;

    const targetPoint: GeoPoint = dwelledFocus
      ? { latitude: dwelledFocus.latitude, longitude: dwelledFocus.longitude }
      : driverPosition;
    const followingZoom = zoomForRingRadius(
      announceDistanceMeters,
      AWARENESS_RING_SIZE / 2,
      driverPosition.latitude
    );
    const targetZoom = dwelledFocus ? FOCUSED_ALERT_ZOOM : followingZoom;
    const pulledBackZoom = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, Math.min(targetZoom, followingZoom) - TRANSITION_ZOOM_OUT_DELTA)
    );
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
        heading: dwelledFocus ? 0 : driverHeadingDeg,
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
    // Deliberately keyed on focusKey alone - driverPosition/driverHeadingDeg/
    // announceDistanceMeters are read live inside for whichever point in
    // time the transition actually fires, not to re-trigger this effect on
    // every ~3s position tick the way the declarative Camera props below do.
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

  // When the camera is focused on a specific alert (tapped or just spoken),
  // the awareness rings/heading chip below are hidden - without a
  // replacement, the driver sees a silent zoomed-in map with no way to
  // tell what they're actually looking at. This reuses
  // announcementLocation()'s existing street/area resolution (including
  // route-number filtering and the suburb-preferring fallback) rather than
  // re-deriving it, same pattern as DriveScreen.tsx's ledger rows.
  const focusLocation = dwelledFocus
    ? announcementLocation({
        alert: dwelledFocus,
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
            dwelledFocus
              ? [dwelledFocus.longitude, dwelledFocus.latitude]
              : driverPosition
                ? [driverPosition.longitude, driverPosition.latitude]
                : undefined
          }
          heading={dwelledFocus ? 0 : driverHeadingDeg}
          zoomLevel={
            dwelledFocus
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
            id="driver-marker"
            coordinate={[driverPosition.longitude, driverPosition.latitude]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <DriverMark />
          </Mapbox.MarkerView>
        ) : null}

        {mapVisibleAlerts.map((alert) => (
          <Mapbox.MarkerView
            key={alert.alert_id}
            coordinate={[alert.longitude, alert.latitude]}
            anchor={{ x: 0.5, y: 1 }}
          >
            <AlertMarker alert={alert} driverPosition={driverPosition} />
          </Mapbox.MarkerView>
        ))}
      </Mapbox.MapView>

      {dwelledFocus ? (
        focusLabel ? (
          <View style={styles.headingChip} pointerEvents="none">
            <Text style={styles.headingChipText}>{focusLabel}</Text>
          </View>
        ) : null
      ) : (
        <>
          <View style={styles.awarenessRingOuter} pointerEvents="none" />
          <View style={styles.awarenessRingInner} pointerEvents="none" />
          <View style={styles.headingChip} pointerEvents="none">
            <Text style={styles.headingChipText}>
              {compassDirection(driverHeadingDeg).toUpperCase()}BOUND
              {headingStreet ? ` · ${headingStreet.toUpperCase()}` : ''}
            </Text>
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
  const isPolice = alert.type === 'POLICE';
  const distanceMeters = useMemo(
    () =>
      driverPosition
        ? haversineDistance(driverPosition, { latitude: alert.latitude, longitude: alert.longitude })
        : null,
    [driverPosition, alert.latitude, alert.longitude]
  );

  if (isPolice) {
    // Just the flashing blue/red light bar - no letter, no distance chip.
    // A real police car doesn't wear a label or a range-finder, just its
    // lights; the other alert types still get the letter+distance
    // treatment since they have no equivalent "just show what it is" glyph.
    return (
      <View
        style={styles.policeMarker}
        accessibilityLabel={
          distanceMeters !== null
            ? `Police alert, ${formatCompactDistance(distanceMeters)} ahead`
            : 'Police alert'
        }
      >
        <PoliceLightBar orientation="horizontal" width={POLICE_MARKER_SIZE} height={POLICE_MARKER_HEIGHT} />
      </View>
    );
  }

  return (
    <View style={styles.alertMarker}>
      <View
        style={styles.alertPin}
        accessibilityLabel={
          distanceMeters !== null
            ? `${meta.label} alert, ${formatCompactDistance(distanceMeters)} ahead`
            : `${meta.label} alert`
        }
      >
        <Text style={styles.alertPinLetter}>{meta.letter}</Text>
      </View>
      {distanceMeters !== null ? (
        <View style={styles.alertDistanceChip}>
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
    backgroundColor: instrument.mapGround,
    paddingHorizontal: 32,
  },
  unsupportedText: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 22,
    color: instrument.mutedOnInk,
    textAlign: 'center',
  },
  awarenessRingOuter: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: AWARENESS_RING_SIZE,
    height: AWARENESS_RING_SIZE,
    marginLeft: -AWARENESS_RING_SIZE / 2,
    marginTop: -AWARENESS_RING_SIZE / 2,
    borderRadius: AWARENESS_RING_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(243,242,242,0.35)',
  },
  awarenessRingInner: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: INNER_AWARENESS_RING_SIZE,
    height: INNER_AWARENESS_RING_SIZE,
    marginLeft: -INNER_AWARENESS_RING_SIZE / 2,
    marginTop: -INNER_AWARENESS_RING_SIZE / 2,
    borderRadius: INNER_AWARENESS_RING_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(243,242,242,0.20)',
  },
  headingChip: {
    position: 'absolute',
    top: 12,
    left: 20,
    backgroundColor: instrument.ink,
    paddingVertical: 3,
    paddingHorizontal: 6,
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
});
