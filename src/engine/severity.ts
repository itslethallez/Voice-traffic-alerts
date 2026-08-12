import type { WazeAlertType } from '../api/waze/types';
import { SEVERITY_ORDER } from './constants';
import type { AnnounceableAlert } from './types';

function severityRank(type: WazeAlertType): number {
  const index = SEVERITY_ORDER.indexOf(type);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

/**
 * Highest severity first (accident, road closure, hazard, police, jam),
 * closer distance first as a tiebreaker within the same severity. Any
 * type not in SEVERITY_ORDER sorts last rather than being dropped.
 */
export function sortBySeverity(candidates: AnnounceableAlert[]): AnnounceableAlert[] {
  return [...candidates].sort((a, b) => {
    const rankDiff = severityRank(a.alert.type) - severityRank(b.alert.type);
    if (rankDiff !== 0) return rankDiff;
    return a.distanceMeters - b.distanceMeters;
  });
}
