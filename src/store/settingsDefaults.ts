import type { AlertType } from '../../shared/alert-schema';
import type { WazeAlertType } from '../api/waze/types';

export type AlertCategory = 'POLICE' | 'ACCIDENT' | 'HAZARD' | 'ROAD_CLOSED' | 'JAM';

export const ALERT_CATEGORIES: AlertCategory[] = [
  'POLICE',
  'ACCIDENT',
  'HAZARD',
  'ROAD_CLOSED',
  'JAM',
];

/**
 * The six normalized alert categories from shared/alert-schema.ts - the
 * Drive screen's filter pills, and the taxonomy every backend alert already
 * arrives in. Distinct from AlertCategory above, which is the legacy
 * Waze-shaped SPEAK THESE voice toggles: this set matches the alert schema
 * 1:1, including 'roadkill', which has no Waze feed equivalent. Type-only
 * import of AlertType keeps zod out of this module's runtime graph.
 */
export type AlertFilterCategory = AlertType;

export const ALERT_FILTER_CATEGORIES: AlertFilterCategory[] = [
  'police',
  'traffic',
  'accident',
  'closure',
  'roadkill',
  'hazard',
];

/**
 * Which filter-pill category each known Waze feed type belongs to - e.g.
 * Waze's JAM is the pill labelled "traffic". Feed types not listed here
 * (unrecognized upstream values) aren't pill-controllable: they keep
 * whatever behaviour they already had.
 */
const WAZE_TYPE_TO_FILTER: Partial<Record<string, AlertFilterCategory>> = {
  POLICE: 'police',
  JAM: 'traffic',
  ACCIDENT: 'accident',
  ROAD_CLOSED: 'closure',
  ROADKILL: 'roadkill',
  HAZARD: 'hazard',
};

export function wazeTypeToAlertFilter(type: WazeAlertType): AlertFilterCategory | null {
  return WAZE_TYPE_TO_FILTER[type] ?? null;
}

/** "Announcement distance slider, 500m to 20km." Only the upper bound is
 * user-configurable - the 300m lower bound stays fixed (announcing
 * something 300m away or closer is a physics/safety floor, not a
 * preference). Default is 5km - independent of engine/announceWindow.ts's
 * own ANNOUNCE_MAX_DISTANCE_M, which is just that module's fallback for
 * callers that don't pass explicit settings (tripRuntime.ts, the live
 * path, always does), not something a fresh install actually uses. */
export const MIN_ANNOUNCE_DISTANCE_METERS = 500;
export const MAX_ANNOUNCE_DISTANCE_METERS = 20000;
export const DEFAULT_ANNOUNCE_DISTANCE_METERS = 5000;

/** Cold-start briefing radius: separate from announceDistanceMeters and
 * deliberately wider, since a stationary driver wants broad situational
 * awareness rather than a just-in-time warning. */
export const MIN_BRIEFING_RADIUS_METERS = 1000;
export const MAX_BRIEFING_RADIUS_METERS = 20000;
export const DEFAULT_BRIEFING_RADIUS_METERS = 5000;

/** Matches expo-speech's own 0.0 (muted) - 1.0 (max) range. */
export const MIN_VOICE_VOLUME = 0;
export const MAX_VOICE_VOLUME = 1;
export const DEFAULT_VOICE_VOLUME = 1;

/** expo-speech: 1.0 is the normal rate. Not a documented hard range, but
 * 0.5-2.0 covers "noticeably slower" to "noticeably faster" without
 * becoming unintelligible. */
export const MIN_VOICE_RATE = 0.5;
export const MAX_VOICE_RATE = 2;
export const DEFAULT_VOICE_RATE = 1;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The three route choices offered when starting navigation
 * (NavigationSearchScreen) and as a default in Settings:
 * - 'quickest': Mapbox's own best route, no hazard scoring.
 * - 'safest': navigationRuntime.ts scores Mapbox's alternative routes by
 *   proximity to currently-reported hazards (the same set already visible
 *   on the map/heard as alerts) and prefers the least-exposed one - not a
 *   guarantee every hazard is dodged, see navigationRuntime.ts's own doc
 *   comment for why.
 * - 'sidestreets': same hazard scoring as 'safest', plus excludes motorways
 *   from the route request entirely (Mapbox Directions' `exclude=motorway`).
 */
export type RouteType = 'quickest' | 'safest' | 'sidestreets';
export const ROUTE_TYPES: RouteType[] = ['quickest', 'safest', 'sidestreets'];

export interface SettingsValues {
  categoriesEnabled: Record<AlertCategory, boolean>;
  /** The Drive screen's category-filter pills - true means the category is
   * shown on the map/sheet and eligible for voice. Defaults all-on; the
   * persisted store merges over this, so older installs without the key
   * pick the defaults up automatically. */
  alertTypeFilters: Record<AlertFilterCategory, boolean>;
  announceDistanceMeters: number;
  briefingRadiusMeters: number;
  voiceVolume: number;
  voiceRate: number;
  masterMute: boolean;
  /** Seeds the route-type control on NavigationSearchScreen each time it
   * opens - the driver can still pick a different type per trip there. */
  defaultRouteType: RouteType;
}

export const defaultSettingsValues: SettingsValues = {
  categoriesEnabled: {
    POLICE: true,
    ACCIDENT: true,
    HAZARD: true,
    ROAD_CLOSED: true,
    JAM: true,
  },
  alertTypeFilters: {
    police: true,
    traffic: true,
    accident: true,
    closure: true,
    roadkill: true,
    hazard: true,
  },
  announceDistanceMeters: DEFAULT_ANNOUNCE_DISTANCE_METERS,
  briefingRadiusMeters: DEFAULT_BRIEFING_RADIUS_METERS,
  voiceVolume: DEFAULT_VOICE_VOLUME,
  voiceRate: DEFAULT_VOICE_RATE,
  masterMute: false,
  defaultRouteType: 'safest',
};

/** The Set<WazeAlertType> shape selectAnnounceableAlerts()'s settings option expects. */
export function enabledTypesFromSettings(
  categoriesEnabled: Record<AlertCategory, boolean>
): ReadonlySet<WazeAlertType> {
  return new Set(ALERT_CATEGORIES.filter((category) => categoriesEnabled[category]));
}

/**
 * The effective enabled-type set once the Drive screen's filter pills are
 * layered on top of the SPEAK THESE voice toggles: a Waze type stays in
 * only when *both* switches allow it (a hidden category is never spoken or
 * shown, and a pill can't re-enable a category voice-muted in Settings).
 * 'ROADKILL' is a normalized-schema type with no SPEAK THESE entry, so its
 * pill alone decides. Unrecognized upstream feed types keep their existing
 * behaviour - enabledTypesFromSettings only ever yields the five known
 * categories, so they were never announceable anyway.
 */
export function enabledTypesFromFilters(
  categoriesEnabled: Record<AlertCategory, boolean>,
  alertTypeFilters: Record<AlertFilterCategory, boolean>
): ReadonlySet<WazeAlertType> {
  const enabled = new Set<WazeAlertType>();
  for (const type of enabledTypesFromSettings(categoriesEnabled)) {
    const filter = wazeTypeToAlertFilter(type);
    if (filter !== null && alertTypeFilters[filter]) enabled.add(type);
  }
  if (alertTypeFilters.roadkill) enabled.add('ROADKILL');
  return enabled;
}
