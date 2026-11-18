import type { RouteOption, RouteOptionId } from '../../store/useRouteOptionsStore';
import { colors } from '../../theme/tokens';

/** Card label for each route option id - all-caps to match the app's
 * eyebrow/label type treatment (FASTEST, QUIETEST, etc. elsewhere). */
export const ROUTE_OPTION_LABELS: Record<RouteOptionId, string> = {
  fastest: 'FASTEST',
  safest: 'SAFEST',
  sidestreets: 'SIDE STREETS',
};

/** The colour each route option's preview line and card accent dot use -
 * token values only, so the map lines stay inside the established palette. */
export const ROUTE_OPTION_COLORS: Record<RouteOptionId, string> = {
  fastest: colors.navigation,
  safest: colors.accent,
  sidestreets: colors.textSecondary,
};

/** "24 min" / "1 hr 5 min" - the stat format the Drive sheet already uses
 * for durations ("{n} MIN" labels), kept local since nothing else formats
 * a seconds value this way yet. */
export function formatRouteDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ${minutes % 60} min`;
}

/** "18.2 km" / "950 m" - distance stat for the cards' secondary line. */
export function formatRouteDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** Plain-English noun for a hazard type, for the "avoids 1 reported X"
 * reason line - mirrors alertTypeMeta.ts's label vocabulary but singular/
 * lowercase, since these read mid-sentence rather than as chips. */
const HAZARD_NOUNS: Record<string, string> = {
  ACCIDENT: 'accident',
  HAZARD: 'hazard',
  ROAD_CLOSED: 'road closure',
  JAM: 'heavy traffic',
  POLICE: 'police',
  MOBILE_CAMERA: 'mobile camera',
  FIXED_CAMERA: 'fixed camera',
  ROADKILL: 'roadkill',
};

function hazardNoun(type: string): string {
  return HAZARD_NOUNS[type] ?? 'incident';
}

function timeDeltaText(option: RouteOption, baseline: RouteOption): string {
  const deltaMin = Math.round((option.route.durationSeconds - baseline.route.durationSeconds) / 60);
  return deltaMin <= 0 ? 'same time' : `+${deltaMin} min`;
}

/** Two routes are "the same" for card-copy purposes when Mapbox handed
 * back identical stats and vertex counts - good enough to avoid claiming
 * a difference where there visibly isn't one, without a full polyline
 * diff. */
function sameGeometry(a: RouteOption, b: RouteOption): boolean {
  return (
    a.route.distanceMeters === b.route.distanceMeters &&
    a.route.durationSeconds === b.route.durationSeconds &&
    a.route.polyline.length === b.route.polyline.length
  );
}

/**
 * The one-line "why this card" reason under each option's stats:
 * - FASTEST: always "Fastest available".
 * - SAFEST: names what it avoids relative to FASTEST (count + hazard
 *   nouns, "+N min" cost), or states plainly that fastest is already the
 *   clearest route when the scorer kept the same geometry - never fakes a
 *   difference.
 * - SIDE STREETS: "Avoids the highway · +N min" when it diverges, or
 *   notes there's no motorway to avoid when it collapsed onto the default.
 */
export function buildRouteOptionReason(option: RouteOption, options: readonly RouteOption[]): string {
  const fastest = options.find((candidate) => candidate.id === 'fastest');

  switch (option.id) {
    case 'fastest':
      return 'Fastest available';
    case 'safest': {
      if (!fastest || sameGeometry(option, fastest)) {
        return 'Fastest route is already the clearest';
      }
      // Hazards on FASTEST that this route genuinely misses - compared by
      // hazard identity (both lists were built from the same shared hazard
      // array; hazardsNearRoute's {hazard, distanceMeters} wrappers are
      // fresh objects per call, so identity on the wrapper won't match).
      const avoided = fastest.hazardsOnRoute.filter(
        (hit) => !option.hazardsOnRoute.some((other) => other.hazard === hit.hazard)
      );
      if (avoided.length === 0) {
        return 'Least exposed to reported incidents';
      }
      const nouns = [...new Set(avoided.map((hit) => hazardNoun(hit.hazard.type)))].slice(0, 2);
      const what =
        avoided.length === 1
          ? nouns[0]
          : `incidents (${nouns.join(' + ')})`;
      return `Avoids ${avoided.length} reported ${what} · ${timeDeltaText(option, fastest)}`;
    }
    case 'sidestreets': {
      if (fastest && sameGeometry(option, fastest)) {
        return 'No motorway on this route';
      }
      return fastest ? `Avoids the highway · ${timeDeltaText(option, fastest)}` : 'Avoids the highway';
    }
  }
}
