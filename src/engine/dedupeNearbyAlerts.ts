import { bearingBetween, bearingDifference } from '../geo/bearing';
import { haversineDistance } from '../geo/distance';
import type { AnnounceableAlert } from './types';

/**
 * Two same-type alerts within this many metres of each other are treated
 * as candidate duplicates of the same real-world incident - e.g. two
 * different Waze users reporting the same police car moments apart. The
 * existing announcedDistances dedupe (selectAlerts.ts) only catches the
 * *same* alert_id being re-seen; it does nothing for two different
 * reporters' alert_ids describing the same thing, which is what this
 * addresses instead. Value confirmed against real on-device duplicate
 * reports, not derived from any Waze-documented behaviour.
 */
export const DUPLICATE_CLUSTER_RADIUS_M = 500;

/**
 * How far from parallel (to the driver's heading, or its reverse) the
 * bearing between two nearby alerts is allowed to be before they're no
 * longer considered "along the same road" and therefore not merged.
 */
const PARALLEL_TOLERANCE_DEG = 45;

/**
 * Below this distance, the bearing between two alerts isn't a meaningful
 * signal - bearingBetween on near-identical coordinates is dominated by
 * GPS/rounding noise rather than real geometry (exactly-coincident points
 * even hit its atan2(0, 0) edge case, an arbitrary due-north result). This
 * is exactly the primary case this whole module exists for: two different
 * reporters describing the same real-world incident from essentially the
 * same spot. Skip the carriageway/bearing check entirely at this range and
 * always treat same-type alerts this close as duplicates; it only starts
 * applying past this radius, where "along the road" vs "across it" is
 * actually measurable.
 */
const SAME_SPOT_RADIUS_M = 30;

/**
 * Guards against merging two alerts that are close in raw distance but on
 * opposite carriageways of a divided road - e.g. police monitoring both
 * directions of a highway, each a genuine, separate presence. Waze's data
 * has no lane/carriageway field, so this approximates the distinction
 * geometrically: two reports of the *same* incident (one physical spot,
 * reported within moments by different passing drivers) are close
 * together in every direction - near-identical coordinates. Two reports on
 * *opposite carriageways* are separated mainly *laterally* - roughly
 * perpendicular to the road's direction of travel - rather than along it.
 * Approximating "the road's direction" as the driver's current heading (a
 * reasonable stand-in while the driver is on the same road the alerts are
 * near), two alerts only count as duplicates if the bearing between them
 * is closer to parallel with that heading (or its reverse - "along the
 * road" is a line, not a direction) than perpendicular to it. Not a
 * perfect signal (doesn't know actual road geometry, curves, etc.), but a
 * meaningfully safer default than distance alone.
 */
function isLikelySameCarriageway(a: AnnounceableAlert, b: AnnounceableAlert, driverHeadingDeg: number): boolean {
  const positionA = { latitude: a.alert.latitude, longitude: a.alert.longitude };
  const positionB = { latitude: b.alert.latitude, longitude: b.alert.longitude };
  if (haversineDistance(positionA, positionB) <= SAME_SPOT_RADIUS_M) return true;

  const bearingBetweenAlerts = bearingBetween(positionA, positionB);
  const diffFromHeading = bearingDifference(driverHeadingDeg, bearingBetweenAlerts);
  const diffFromReverseHeading = bearingDifference((driverHeadingDeg + 180) % 360, bearingBetweenAlerts);
  return Math.min(diffFromHeading, diffFromReverseHeading) <= PARALLEL_TOLERANCE_DEG;
}

/** Prefers the more corroborated report as the one actually spoken -
 * reliability first, thumbs-up as a tiebreak. */
function isMoreTrustworthy(a: AnnounceableAlert, b: AnnounceableAlert): boolean {
  if (a.alert.alert_reliability !== b.alert.alert_reliability) {
    return a.alert.alert_reliability > b.alert.alert_reliability;
  }
  return a.alert.num_thumbs_up > b.alert.num_thumbs_up;
}

/**
 * Collapses multiple same-type candidates that likely describe the same
 * real-world incident down to one per cluster, keeping whichever is most
 * corroborated. Only ever merges within a single call's candidate list
 * (one poll's worth of alerts, already distance/bearing/freshness/category
 * filtered) - never compares across separate calls, so this has no memory
 * of its own between driver updates.
 */
export function dedupeNearbyAlerts(
  candidates: AnnounceableAlert[],
  driverHeadingDeg: number,
  radiusMeters: number = DUPLICATE_CLUSTER_RADIUS_M
): AnnounceableAlert[] {
  const kept: AnnounceableAlert[] = [];

  for (const candidate of candidates) {
    const duplicateIndex = kept.findIndex(
      (existing) =>
        existing.alert.type === candidate.alert.type &&
        haversineDistance(
          { latitude: existing.alert.latitude, longitude: existing.alert.longitude },
          { latitude: candidate.alert.latitude, longitude: candidate.alert.longitude }
        ) <= radiusMeters &&
        isLikelySameCarriageway(existing, candidate, driverHeadingDeg)
    );

    if (duplicateIndex === -1) {
      kept.push(candidate);
    } else if (isMoreTrustworthy(candidate, kept[duplicateIndex])) {
      kept[duplicateIndex] = candidate;
    }
  }

  return kept;
}
