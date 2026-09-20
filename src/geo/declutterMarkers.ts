import { haversineDistance } from './distance';

/**
 * On-map marker decluttering. Alert and fixed-camera markers each render
 * as individual MarkerViews with no collision handling, so a cluster of
 * reports at one intersection (or a camera sitting on an alert) stacks
 * into an unreadable pile. This groups markers closer together than one
 * glyph-width on screen into a cluster: the most relevant marker (nearest
 * the driver, or one explicitly pinned like the selected/focused alert)
 * renders normally with a "+N" badge; the rest are still announced and
 * listed, just not drawn on top of each other.
 */

/** Roughly one marker glyph plus breathing room, in screen pixels - below
 * this separation the icons physically overlap at any reasonable size. */
export const MARKER_MIN_SEPARATION_PX = 48;

/**
 * Metres corresponding to MARKER_MIN_SEPARATION_PX at the given map zoom
 * and latitude (standard Web-Mercator metres-per-pixel). The caller passes
 * the map's current zoom so the same screen-space rule holds whether the
 * driver is zoomed in tight or looking at the whole region.
 */
export function markerSeparationMeters(zoom: number, latitude: number): number {
  const metersPerPixel = (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom);
  return MARKER_MIN_SEPARATION_PX * metersPerPixel;
}

export interface ClusterableMarker {
  id: string;
  latitude: number;
  longitude: number;
}

export interface MarkerCluster<T extends ClusterableMarker> {
  /** The marker actually drawn - the pinned one if the cluster contains
   * one, otherwise the nearest to the driver. */
  primary: T;
  /** Every marker in the cluster, primary first. */
  members: T[];
}

/**
 * Greedy single-pass clustering: sort by priority (pinned first, then
 * nearest the driver), then each marker joins the first existing cluster
 * within `separationMeters` of that cluster's primary - or starts a new
 * one. Pinned markers never get absorbed into someone else's cluster, so
 * a focused/selected alert always renders as itself.
 */
export function clusterMarkers<T extends ClusterableMarker>(
  items: readonly T[],
  options: {
    separationMeters: number;
    driverPosition?: { latitude: number; longitude: number } | null;
    pinnedIds?: ReadonlySet<string>;
  }
): MarkerCluster<T>[] {
  const { separationMeters, driverPosition, pinnedIds } = options;
  const distanceToDriver = (item: T) =>
    driverPosition ? haversineDistance(driverPosition, item) : Number.MAX_SAFE_INTEGER;

  const sorted = [...items].sort((a, b) => {
    const pinnedA = pinnedIds?.has(a.id) ? 0 : 1;
    const pinnedB = pinnedIds?.has(b.id) ? 0 : 1;
    if (pinnedA !== pinnedB) return pinnedA - pinnedB;
    return distanceToDriver(a) - distanceToDriver(b);
  });

  const clusters: MarkerCluster<T>[] = [];
  for (const item of sorted) {
    if (!pinnedIds?.has(item.id)) {
      const host = clusters.find((cluster) => haversineDistance(cluster.primary, item) <= separationMeters);
      if (host) {
        host.members.push(item);
        continue;
      }
    }
    clusters.push({ primary: item, members: [item] });
  }
  return clusters;
}
