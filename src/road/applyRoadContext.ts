import type { WazeAlert, WazeAlertType } from '../api/waze/types';
import { ANNOUNCE_MAX_BEARING_DIFF_DEG, isMeaningfullyCloser } from '../geo/announceWindow';
import { isOnDriversRoad, type AnnounceableAlert, type ApproachingAlert, type RoadContext } from '../engine/types';
import type { RoadTarget } from './classifyRoute';
import type { RoadLookup } from './roadContextRuntime';
import { roadNamesIn } from './roadNames';

export type RoadLookupFn = (target: RoadTarget) => RoadLookup;

/**
 * Alert types announced when they're behind the driver (or need a U-turn
 * to reach): "behind you, X away", once per alert. Police and mobile
 * cameras only - any other type behind stays silent. Stage 3c, agreed
 * 28 Nov 2026 (CLAUDE.md). Cruise only: Navigate selects by route
 * corridor and never reaches applyRoadContext.
 */
export const ANNOUNCED_BEHIND_TYPES: ReadonlySet<WazeAlertType> = new Set<WazeAlertType>(['POLICE', 'MOBILE_CAMERA']);
/** "Behind you" is only said for an alert actually behind the driver -
 * more than this off their heading. */
export const BEHIND_YOU_MIN_BEARING_DEG = 90;

export function roadTargetForAlert(alert: WazeAlert): RoadTarget {
  return {
    id: alert.alert_id,
    position: { latitude: alert.latitude, longitude: alert.longitude },
    streets: roadNamesIn(alert.street),
    kind: alert.type === 'MOBILE_CAMERA' ? 'mobileCamera' : alert.type === 'FIXED_CAMERA' ? 'fixedCamera' : 'alert',
  };
}

/**
 * Turns pre-selected candidates (selected with the wider road-matching
 * cone, and *without* the announced-distance dedupe - see below) into what
 * may actually be announced:
 *
 * - still being looked up: held back this pass (roadContextRuntime caps
 *   the wait at MAX_PENDING_MS, then answers "nearby");
 * - behind / needs a U-turn: police and mobile cameras are kept (spoken
 *   "behind you, X away", straight-line distance) unless already said
 *   once for that alert (`behindAnnounced`); any other type is dropped -
 *   silent;
 * - ahead / onRoad (the other carriageway of the driver's divided road):
 *   distance becomes the along-road distance, which must itself be inside
 *   the type's warn radius;
 * - nearby (direction not certain): kept only inside the ordinary
 *   45-degree heading cone, with the straight-line distance, spoken "in
 *   your warning area" - road matching widens what can be "ahead" (a road
 *   bending away), never what gets mentioned without a direction.
 *
 * The reminder rule (announce again once 1km closer) is applied here, on
 * the final distance, so an along-road distance is compared with the
 * along-road distance it was last announced at.
 */
export function applyRoadContext(
  candidates: readonly AnnounceableAlert[],
  lookup: RoadLookupFn,
  radiusFor: (type: WazeAlertType) => number,
  announcedDistances: ReadonlyMap<string, number>,
  behindAnnounced: ReadonlySet<string> = new Set()
): AnnounceableAlert[] {
  const out: AnnounceableAlert[] = [];
  for (const candidate of candidates) {
    const decided = decide(candidate, lookup, radiusFor, behindAnnounced);
    if (!decided) continue;
    const last = announcedDistances.get(candidate.alert.alert_id);
    if (last !== undefined && !isMeaningfullyCloser(decided.distanceMeters, last)) continue;
    out.push(decided);
  }
  return out;
}

/** Same rules for alerts still outside the warn radius, to predict their
 * entry sentence for the TTS prefetch - from what's already known only
 * (`peek`, roadContextRuntime's peekRoadContext). No lookup starts until
 * the alert is inside its radius (21 Nov 2026 cost decision); unknown is
 * predicted with the "nearby" wording, which is what it'd be spoken as if
 * the lookup didn't land in time. */
export function applyRoadContextToApproaching(
  approaching: readonly ApproachingAlert[],
  peek: (target: RoadTarget) => RoadContext | null,
  behindAnnounced: ReadonlySet<string> = new Set()
): ApproachingAlert[] {
  const out: ApproachingAlert[] = [];
  for (const a of approaching) {
    const known = peek(roadTargetForAlert(a.candidate.alert));
    const decided = decide(a.candidate, () => known ?? { kind: 'nearby' }, () => Infinity, behindAnnounced);
    if (decided) out.push({ ...a, candidate: decided });
  }
  return out;
}

function decide(
  candidate: AnnounceableAlert,
  lookup: RoadLookupFn,
  radiusFor: (type: WazeAlertType) => number,
  behindAnnounced: ReadonlySet<string>
): AnnounceableAlert | null {
  const answer = lookup(roadTargetForAlert(candidate.alert));
  if (answer === 'pending') return null;
  if (answer.kind === 'behind') {
    if (!ANNOUNCED_BEHIND_TYPES.has(candidate.alert.type)) return null;
    if (candidate.bearingDiffDeg <= BEHIND_YOU_MIN_BEARING_DEG) {
      // "Behind" only because the router needs a U-turn (a turn off, then
      // back along the far carriageway), but it's in front of the driver:
      // saying "behind you" would be wrong. Its direction isn't certain -
      // the ordinary warning-area rule (45-degree cone) applies.
      if (candidate.bearingDiffDeg > ANNOUNCE_MAX_BEARING_DIFF_DEG) return null;
      return { ...candidate, road: { kind: 'nearby' } };
    }
    if (behindAnnounced.has(candidate.alert.alert_id)) return null;
    return { ...candidate, road: answer };
  }
  if (isOnDriversRoad(answer)) {
    if (answer.alongRoadMeters > radiusFor(candidate.alert.type)) return null;
    return { ...candidate, distanceMeters: answer.alongRoadMeters, road: answer };
  }
  if (candidate.bearingDiffDeg > ANNOUNCE_MAX_BEARING_DIFF_DEG) return null;
  return { ...candidate, road: answer };
}
