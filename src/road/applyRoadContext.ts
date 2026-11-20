import type { WazeAlert, WazeAlertType } from '../api/waze/types';
import { ANNOUNCE_MAX_BEARING_DIFF_DEG, isMeaningfullyCloser } from '../geo/announceWindow';
import type { AnnounceableAlert, ApproachingAlert } from '../engine/types';
import type { RoadTarget } from './classifyRoute';
import type { RoadLookup } from './roadContextRuntime';
import { roadNamesIn } from './roadNames';

export type RoadLookupFn = (target: RoadTarget) => RoadLookup;

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
 * - behind / needs a U-turn: dropped - silent;
 * - ahead: distance becomes the along-road distance, which must itself be
 *   inside the type's warn radius;
 * - nearby: kept only inside the ordinary 45-degree heading cone, with the
 *   straight-line distance - road matching widens what can be "ahead"
 *   (a road bending away), never what gets mentioned as "nearby".
 *
 * The reminder rule (announce again once 1km closer) is applied here, on
 * the final distance, so an along-road distance is compared with the
 * along-road distance it was last announced at.
 */
export function applyRoadContext(
  candidates: readonly AnnounceableAlert[],
  lookup: RoadLookupFn,
  radiusFor: (type: WazeAlertType) => number,
  announcedDistances: ReadonlyMap<string, number>
): AnnounceableAlert[] {
  const out: AnnounceableAlert[] = [];
  for (const candidate of candidates) {
    const decided = decide(candidate, lookup, radiusFor);
    if (!decided) continue;
    const last = announcedDistances.get(candidate.alert.alert_id);
    if (last !== undefined && !isMeaningfullyCloser(decided.distanceMeters, last)) continue;
    out.push(decided);
  }
  return out;
}

/** Same rules for alerts still outside the warn radius - used to predict
 * their entry sentence for the TTS prefetch, and to get their road lookup
 * in before they're due. */
export function applyRoadContextToApproaching(
  approaching: readonly ApproachingAlert[],
  lookup: RoadLookupFn
): ApproachingAlert[] {
  const out: ApproachingAlert[] = [];
  for (const a of approaching) {
    const decided = decide(a.candidate, lookup, () => Infinity);
    if (decided) out.push({ ...a, candidate: decided });
  }
  return out;
}

function decide(
  candidate: AnnounceableAlert,
  lookup: RoadLookupFn,
  radiusFor: (type: WazeAlertType) => number
): AnnounceableAlert | null {
  const answer = lookup(roadTargetForAlert(candidate.alert));
  if (answer === 'pending' || answer.kind === 'behind') return null;
  if (answer.kind === 'ahead') {
    if (answer.alongRoadMeters > radiusFor(candidate.alert.type)) return null;
    return { ...candidate, distanceMeters: answer.alongRoadMeters, road: answer };
  }
  if (candidate.bearingDiffDeg > ANNOUNCE_MAX_BEARING_DIFF_DEG) return null;
  return { ...candidate, road: answer };
}
