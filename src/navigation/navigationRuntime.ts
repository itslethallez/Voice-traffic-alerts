import { fetchDirections, MapboxApiError } from '../api/mapbox/client';
import type { DriverState } from '../engine/types';
import { distanceToPolyline } from '../geo/routePolyline';
import type { GeoPoint } from '../geo/types';
import { formatManeuverInstruction } from '../speech/formatManeuverInstruction';
import { speakAsync, stopSpeaking } from '../speech/ttsAdapter';
import { type RouteType } from '../store/settingsDefaults';
import { useNavigationStore, type NavigationRoute } from '../store/useNavigationStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { selectManeuverAnnouncement, type ManeuverCheckpoint } from './selectManeuverAnnouncement';
import { getHazardsForRouteScoring, routeTypeToRequestOptions, scoreAndRankRoutes } from './routeSelection';
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

async function requestRoute(
  origin: GeoPoint,
  destination: GeoPoint,
  routeType: RouteType,
  nowMs: number,
  reason: 'start' | 'reroute'
): Promise<NavigationRoute> {
  const { avoidHazards, exclude } = routeTypeToRequestOptions(routeType);
  // Logged per-request so a device log can tell a deliberate planning
  // request pair (see routeOptions.ts) apart from a genuine second fetch
  // on GO (should never happen - startNavigationWithRoute doesn't call
  // this) or an off-route reroute.
  console.log(`[nav] directions request (${reason}) type=${routeType}`);
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
  console.log(`[nav] startNavigation: fetching route type=${options.routeType}`);

  try {
    const route = await requestRoute(driver.position, destination, options.routeType, Date.now(), 'start');
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

export interface StartNavigationWithRouteInput {
  destination: GeoPoint;
  destinationLabel: string | null;
  /** Which of the presented options the driver picked - recorded as
   * activeRouteType so a later off-route reroute re-requests the same
   * flavour of route rather than the settings default. */
  routeType: RouteType;
  /** The already-fetched route (Stage B's RouteOption.route) - adopted
   * verbatim rather than re-requested, so the geometry the driver tapped
   * GO on is exactly the one they get. */
  route: NavigationRoute;
}

/**
 * Stage B -> C handoff: the driver picked one of the route options and
 * confirmed GO. Unlike startNavigation() this does NOT call Directions
 * again - the route was already fetched (and hazard-scored) for the
 * options screen, so re-requesting would both waste a call and risk
 * handing back different geometry than the card described.
 */
export function startNavigationWithRoute(input: StartNavigationWithRouteInput): void {
  navigationGeneration += 1; // invalidates any in-flight request/reroute
  resetStepTracking();
  const store = useNavigationStore.getState();
  store.setRouting(input.routeType);
  store.setActiveRoute({
    destination: input.destination,
    destinationLabel: input.destinationLabel,
    route: input.route,
  });
  console.log(
    `[nav] startWithRoute: status=${useNavigationStore.getState().status} type=${input.routeType} ` +
      `dist=${Math.round(input.route.distanceMeters)}m steps=${input.route.steps.length} ` +
      `dest=${input.destinationLabel ?? '(unlabeled)'} (no refetch)`
  );
}

export function stopNavigation(): void {
  navigationGeneration += 1; // invalidates any in-flight request/reroute
  resetStepTracking();
  useNavigationStore.getState().stop();
  console.log('[nav] stopped - back to cruising');
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
  console.log(`[nav] rerouting from current position (type=${routeType})`);

  try {
    const route = await requestRoute(driver.position, destination, routeType, Date.now(), 'reroute');
    if (generation !== navigationGeneration) return;
    useNavigationStore.getState().setActiveRoute({ destination, destinationLabel, route });
    console.log(`[nav] reroute applied: dist=${Math.round(route.distanceMeters)}m steps=${route.steps.length}`);
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
  const previousStepIndex = currentStepIndex;
  currentStepIndex = progress.currentStepIndex;

  if (progress.hasArrived) {
    console.log(`[nav] arrived at ${store.destinationLabel ?? 'destination'} - ending navigation`);
    // Speak the final step's own instruction ("You have arrived at …")
    // before tearing down - same serialized speech channel as the maneuver
    // cues, so it can't collide with an announcement still playing.
    if (!options.masterMute) {
      const arrivalInstruction = route.steps[route.steps.length - 1]?.maneuver.instruction;
      if (arrivalInstruction) {
        try {
          await stopSpeaking();
          await speakAsync(arrivalInstruction, {
            rate: useSettingsStore.getState().voiceRate,
            volume: useSettingsStore.getState().voiceVolume,
          });
        } catch (error) {
          console.warn('[navigation] failed to speak the arrival instruction', error);
        }
      }
    }
    stopNavigation();
    return;
  }

  const deviationM = distanceToPolyline(driver.position, route.polyline);
  const etaMs =
    nowMs + (progress.remainingDistanceM / Math.max(route.distanceMeters, 1)) * route.durationSeconds * 1000;

  // Per-processed-fix progress line: on a healthy device this ticks every
  // location update with decreasing remain/eta. If the serialized chain
  // is backed up behind speech, these lines arrive in bursts of stale
  // values instead - the frozen-ETA signature.
  console.log(
    `[nav] step ${progress.currentStepIndex}${progress.currentStepIndex !== previousStepIndex ? ` (was ${previousStepIndex})` : ''} ` +
      `next=${Math.round(progress.distanceToNextManeuverM)}m remain=${Math.round(progress.remainingDistanceM)}m ` +
      `eta=+${Math.round((etaMs - nowMs) / 1000)}s dev=${Math.round(deviationM)}m`
  );

  useNavigationStore.getState().setStepProgress({
    currentStepIndex: progress.currentStepIndex,
    distanceToNextManeuverM: progress.distanceToNextManeuverM,
    remainingDistanceM: progress.remainingDistanceM,
    // Assumes the remaining time is proportional to remaining distance at
    // the route's own average pace - an approximation, not a live
    // recompute against current speed, good enough for a driving ETA.
    etaMs,
  });

  if (!options.masterMute) {
    await speakManeuverIfDue(route, progress.currentStepIndex, progress.distanceToNextManeuverM);
  }

  if (store.status !== 'navigating') return; // already mid-reroute; don't trigger a second one

  if (deviationM <= OFF_ROUTE_DEVIATION_M) {
    offRouteSinceMs = null;
    return;
  }

  if (offRouteSinceMs === null) {
    offRouteSinceMs = nowMs;
    console.log(`[nav] off-route deviation ${Math.round(deviationM)}m - watching for ${OFF_ROUTE_SUSTAINED_MS / 1000}s before rerouting`);
    return;
  }

  if (nowMs - offRouteSinceMs >= OFF_ROUTE_SUSTAINED_MS) {
    console.log(`[nav] off-route sustained (${Math.round(deviationM)}m) - rerouting`);
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
