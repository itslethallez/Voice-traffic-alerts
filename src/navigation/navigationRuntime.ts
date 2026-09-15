import { fetchDirections, MapboxApiError } from '../api/mapbox/client';
import type { DriverState } from '../engine/types';
import type { RouteHazard } from '../engine/routeHazardScore';
import { distanceToPolyline } from '../geo/routePolyline';
import type { GeoPoint } from '../geo/types';
import { formatManeuverInstruction } from '../speech/formatManeuverInstruction';
import { speakAsync, stopSpeaking } from '../speech/ttsAdapter';
import { visibleManualReportAlerts } from '../store/manualReportAlert';
import { visibleNearbyReportAlerts } from '../store/nearbyReportAlert';
import { enabledTypesFromSettings, type RouteType } from '../store/settingsDefaults';
import { useNavigationStore, type NavigationRoute } from '../store/useNavigationStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTripStore } from '../store/useTripStore';
import { selectManeuverAnnouncement, type ManeuverCheckpoint } from './selectManeuverAnnouncement';
import { routeTypeToRequestOptions, scoreAndRankRoutes } from './routeSelection';
import { computeStepProgress } from './stepProgress';

/**
 * How far off the active route's polyline the driver has to stray, and
 * for how long, before this reroutes from the current position - mirrors
 * engine/movement.ts's own "don't overreact to one noisy fix" philosophy
 * (a brief GPS wobble near an overpass/interchange shouldn't trigger a
 * fresh Directions request).
 */
const OFF_ROUTE_DEVIATION_M = 45;
const OFF_ROUTE_SUSTAINED_MS = 10_000;
/** How wide a radius around the driver's position counts as "nearby
 * enough to matter" when gathering manual/nearby reports for route
 * scoring - deliberately generous relative to routeSelection.ts's own
 * HAZARD_CORRIDOR_METERS (which then does the real, route-shaped
 * filtering), just enough to skip fetching truly irrelevant reports. */
const HAZARD_GATHER_RADIUS_METERS = 6000;

/**
 * Module-level (not React state), same reasoning as tripRuntime.ts's own
 * announcerState/movementState/etc: navigationRuntime has no component to
 * hold refs in, and needs to stay consistent regardless of which caller
 * (foreground hook, background task) happens to be driving it. Only ever
 * touched from within tripRuntime.ts's already-serialized
 * handleDriverUpdateSerialized, so this never needs its own lock.
 */
let currentStepIndex = 0;
let firedManeuverCheckpoints: Map<number, Set<ManeuverCheckpoint>> = new Map();
let offRouteSinceMs: number | null = null;
/** Bumped on every start/stop/reroute so a Directions response for a
 * superseded request (the driver picked a new destination, or cancelled,
 * while the old fetch was still in flight) can't land and clobber newer
 * state once it finally resolves. */
let navigationGeneration = 0;

function resetStepTracking(): void {
  currentStepIndex = 0;
  firedManeuverCheckpoints = new Map();
  offRouteSinceMs = null;
}

/**
 * The same hazard set already visible on the map (RadarMap.tsx's
 * mapVisibleAlerts) and spoken as alerts - Waze's own alerts plus this
 * device's and nearby devices' manual reports, filtered by whichever
 * categories are currently enabled - gathered here independently since
 * this runs outside any component. Keeping route scoring and what the
 * driver already sees/hears in sync by construction, rather than building
 * a second, different notion of "hazard" just for routing.
 */
function getHazardsForRouteScoring(driverPosition: GeoPoint, nowMs: number): RouteHazard[] {
  const trip = useTripStore.getState();
  const enabledTypes = enabledTypesFromSettings(useSettingsStore.getState().categoriesEnabled);
  const waze = trip.visibleAlerts.filter((alert) => enabledTypes.has(alert.type));
  const manual = visibleManualReportAlerts(trip.manualReports, driverPosition, nowMs, HAZARD_GATHER_RADIUS_METERS).filter(
    (alert) => enabledTypes.has(alert.type)
  );
  const nearby = visibleNearbyReportAlerts(trip.nearbyReports, driverPosition, nowMs, HAZARD_GATHER_RADIUS_METERS).filter(
    (alert) => enabledTypes.has(alert.type)
  );
  return [...waze, ...manual, ...nearby];
}

async function requestRoute(
  origin: GeoPoint,
  destination: GeoPoint,
  routeType: RouteType,
  nowMs: number
): Promise<NavigationRoute> {
  const { avoidHazards, exclude } = routeTypeToRequestOptions(routeType);
  const response = await fetchDirections([origin, destination], { alternatives: true, exclude });
  if (response.routes.length === 0) {
    throw new MapboxApiError('Mapbox Directions API returned no routes', null);
  }

  const hazards = getHazardsForRouteScoring(origin, nowMs);
  const [best] = scoreAndRankRoutes(response, hazards, avoidHazards);
  const steps = best.route.legs.flatMap((leg) => leg.steps);

  return {
    polyline: best.polyline,
    steps,
    distanceMeters: best.route.distance,
    durationSeconds: best.route.duration,
    hazardScore: best.hazardScore,
  };
}

export interface StartNavigationOptions {
  routeType: RouteType;
}

/**
 * Fetches a route to `destination` from the driver's current position and
 * makes it the active route. Not a guarantee the chosen route avoids every
 * currently-reported hazard for the 'safest'/'sidestreets' route types -
 * Mapbox's Directions API has no way to request excluding arbitrary points
 * server-side, only the broad category excludes (motorway/toll/ferry, see
 * routeSelection.ts's routeTypeToRequestOptions). This instead requests
 * alternatives (Mapbox returns up to ~2) and picks whichever is least
 * hazard-exposed by routeSelection.ts's own scoring - the least-bad option
 * among what Mapbox happened to offer, not a guaranteed-clear route.
 */
export async function startNavigation(
  destination: GeoPoint,
  destinationLabel: string | null,
  driver: DriverState,
  options: StartNavigationOptions
): Promise<void> {
  const generation = ++navigationGeneration;
  resetStepTracking();
  useNavigationStore.getState().setRouting(options.routeType);

  try {
    const route = await requestRoute(driver.position, destination, options.routeType, Date.now());
    if (generation !== navigationGeneration) return; // superseded while this fetch was in flight
    useNavigationStore.getState().setActiveRoute({ destination, destinationLabel, route });
  } catch (error) {
    if (generation !== navigationGeneration) return;
    console.warn('[navigation] failed to fetch a route', error);
    useNavigationStore
      .getState()
      .setError(error instanceof MapboxApiError ? error.message : 'Could not calculate a route.');
  }
}

export function stopNavigation(): void {
  navigationGeneration += 1; // invalidates any in-flight request/reroute
  resetStepTracking();
  useNavigationStore.getState().stop();
}

async function rerouteFromCurrentPosition(driver: DriverState): Promise<void> {
  const store = useNavigationStore.getState();
  const { destination, destinationLabel, activeRouteType } = store;
  if (!destination) return;

  // Reuses whichever route type the driver actually chose for this trip
  // (persisted on the store by setRouting/setActiveRoute) rather than
  // re-reading the settings default, which may have changed since - and
  // falls back defensively to 'safest' in case a reroute is ever somehow
  // triggered with no route type recorded (shouldn't happen: a route can't
  // be active without one having been set first).
  const routeType = activeRouteType ?? 'safest';

  const generation = ++navigationGeneration;
  store.setRerouting();
  resetStepTracking();

  try {
    const route = await requestRoute(driver.position, destination, routeType, Date.now());
    if (generation !== navigationGeneration) return;
    useNavigationStore.getState().setActiveRoute({ destination, destinationLabel, route });
  } catch (error) {
    if (generation !== navigationGeneration) return;
    console.warn('[navigation] reroute failed, keeping the previous route', error);
    // Serve what we have rather than dropping navigation entirely on a
    // transient failure - same posture as engine/cache.ts's
    // applyFetchResult for Waze alerts. Falls back to 'navigating' (not
    // 'rerouting', which would otherwise stick) via setStepProgress below.
    const stale = useNavigationStore.getState();
    if (stale.activeRoute) {
      useNavigationStore.getState().setStepProgress({
        currentStepIndex: 0,
        distanceToNextManeuverM: stale.activeRoute.steps[0]?.distance ?? 0,
        remainingDistanceM: stale.activeRoute.distanceMeters,
        etaMs: Date.now() + stale.activeRoute.durationSeconds * 1000,
      });
    }
  }
}

async function speakManeuverIfDue(route: NavigationRoute, stepIndex: number, distanceToNextManeuverM: number): Promise<void> {
  if (stepIndex >= route.steps.length - 1) return; // final step - no further maneuver to announce

  const result = selectManeuverAnnouncement({
    distanceToNextManeuverM,
    stepIndex,
    firedCheckpoints: firedManeuverCheckpoints,
  });
  if (!result) return;

  const fired = firedManeuverCheckpoints.get(result.stepIndex) ?? new Set<ManeuverCheckpoint>();
  fired.add(result.checkpoint);
  firedManeuverCheckpoints.set(result.stepIndex, fired);

  const settings = useSettingsStore.getState();
  // The live measured distance at the moment this checkpoint crossing fired,
  // not the fixed checkpoint number itself - result.checkpoint only decides
  // *when* to speak (see selectManeuverAnnouncement.ts), so the driver hears
  // an accurate, natural distance rather than always "500"/"200"/"50".
  const text = formatManeuverInstruction(route.steps[stepIndex + 1].maneuver, distanceToNextManeuverM);

  try {
    // Every driver-update call runs one at a time through tripRuntime.ts's
    // serialized updateChain (never concurrently with the hazard
    // announcer's own tick()/checkSpeedCameraWarning calls), so awaiting
    // here - rather than firing this off unawaited - is what actually
    // guarantees a turn cue can't land mid-utterance against a hazard
    // readout: whichever runs first in a given update fully finishes
    // speaking before the next one starts. stopSpeaking() first is a
    // defensive no-op in the common case, and a real cutoff only for
    // whatever a genuinely concurrent caller (e.g. useDriveLoop.ts's phone-
    // call handler) left mid-utterance from outside this chain entirely.
    await stopSpeaking();
    await speakAsync(text, { rate: settings.voiceRate, volume: settings.voiceVolume });
  } catch (error) {
    console.warn('[navigation] failed to speak a maneuver instruction', error);
  }
}

export interface UpdateNavigationOptions {
  /** Mirrors settings.masterMute - navigation's own position/step/ETA
   * tracking (and reroute detection) still runs while muted, since a
   * driver who muted audio still wants a live map and ETA, but speaking
   * a maneuver cue is skipped, same as every other speech path already
   * respects masterMute. */
  masterMute: boolean;
}

/**
 * Called from tripRuntime.ts's handleDriverUpdateSerialized, which is
 * already serialized against both the foreground watch and the background
 * task - this never needs its own lock as a result. A no-op whenever
 * navigation isn't active, so wiring this into every driver update costs
 * nothing the rest of the time.
 */
export async function updateNavigationForDriverUpdate(
  driver: DriverState,
  nowMs: number,
  options: UpdateNavigationOptions
): Promise<void> {
  const store = useNavigationStore.getState();
  if (store.status !== 'navigating' && store.status !== 'rerouting') return;
  const route = store.activeRoute;
  if (!route) return;

  const progress = computeStepProgress(driver.position, route.steps, currentStepIndex);
  currentStepIndex = progress.currentStepIndex;

  if (progress.hasArrived) {
    stopNavigation();
    return;
  }

  useNavigationStore.getState().setStepProgress({
    currentStepIndex: progress.currentStepIndex,
    distanceToNextManeuverM: progress.distanceToNextManeuverM,
    remainingDistanceM: progress.remainingDistanceM,
    // Assumes the remaining time is proportional to remaining distance at
    // the route's own average pace - an approximation, not a live
    // recompute against current speed, good enough for a driving ETA.
    etaMs: nowMs + (progress.remainingDistanceM / Math.max(route.distanceMeters, 1)) * route.durationSeconds * 1000,
  });

  if (!options.masterMute) {
    await speakManeuverIfDue(route, progress.currentStepIndex, progress.distanceToNextManeuverM);
  }

  if (store.status !== 'navigating') return; // already mid-reroute; don't trigger a second one

  const deviationM = distanceToPolyline(driver.position, route.polyline);
  if (deviationM <= OFF_ROUTE_DEVIATION_M) {
    offRouteSinceMs = null;
    return;
  }

  if (offRouteSinceMs === null) {
    offRouteSinceMs = nowMs;
    return;
  }

  if (nowMs - offRouteSinceMs >= OFF_ROUTE_SUSTAINED_MS) {
    void rerouteFromCurrentPosition(driver);
  }
}

/** Whether turn-by-turn navigation is currently driving the trip (nav mode)
 * as opposed to plain cruising - used by tripRuntime.ts to decide whether
 * hazard announcements should be gated to the active route's corridor
 * instead of the usual radius-around-the-car window. */
export function isNavigationActive(): boolean {
  const status = useNavigationStore.getState().status;
  return status === 'navigating' || status === 'rerouting';
}

/**
 * The active route's geometry from the driver's current step onward - the
 * part of the journey still ahead, not the whole route from origin to
 * destination - so a hazard already passed doesn't keep counting as "near
 * the route". Built from each remaining step's own geometry (rather than
 * slicing the route's one polyline by distance) since steps already carry
 * their own coordinates and are trivial to concatenate. Returns null
 * whenever navigation isn't active.
 */
export function getRemainingRoutePolyline(): GeoPoint[] | null {
  const route = useNavigationStore.getState().activeRoute;
  if (!route) return null;
  return route.steps
    .slice(currentStepIndex)
    .flatMap((step) => step.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude })));
}
