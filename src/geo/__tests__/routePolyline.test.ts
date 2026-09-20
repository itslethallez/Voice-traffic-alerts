import { distanceToPolyline, nearestPointOnPolyline } from '../routePolyline';

/** A short straight "road" running north from Adelaide Railway Station,
 * roughly along a meridian so metres-per-degree-latitude is the dominant
 * axis and expected distances are easy to sanity-check by hand. */
const ROAD_START = { latitude: -34.92168, longitude: 138.59739 };
const ROAD_END = { latitude: -34.9155556, longitude: 138.59739 };
const ROAD: [typeof ROAD_START, typeof ROAD_END] = [ROAD_START, ROAD_END];

describe('distanceToPolyline', () => {
  it('is ~0 for a point on the polyline itself', () => {
    expect(distanceToPolyline(ROAD_START, ROAD)).toBeLessThan(1);
  });

  it('is ~0 for a point on the polyline between its endpoints', () => {
    const midOfRoad = { latitude: (ROAD_START.latitude + ROAD_END.latitude) / 2, longitude: ROAD_START.longitude };
    expect(distanceToPolyline(midOfRoad, ROAD)).toBeLessThan(1);
  });

  it('measures perpendicular distance from a point off to the side', () => {
    // ~0.001 degrees of longitude east of the midpoint, at Adelaide's
    // latitude (~-34.9) that's roughly 91m (111,320 * cos(34.9°) * 0.001).
    const offToTheSide = {
      latitude: (ROAD_START.latitude + ROAD_END.latitude) / 2,
      longitude: ROAD_START.longitude + 0.001,
    };
    const distance = distanceToPolyline(offToTheSide, ROAD);
    expect(distance).toBeGreaterThan(80);
    expect(distance).toBeLessThan(100);
  });

  it('clamps to the nearest endpoint for a point beyond the segment', () => {
    const wayPastTheEnd = { latitude: ROAD_END.latitude + 1, longitude: ROAD_END.longitude };
    const distance = distanceToPolyline(wayPastTheEnd, ROAD);
    // Should be close to the direct distance to ROAD_END, not to some
    // point projected past it along the segment's direction.
    expect(distance).toBeGreaterThan(100_000);
    expect(distance).toBeLessThan(112_000);
  });

  it('finds the closest of several segments, not just the first', () => {
    const farSegment: [typeof ROAD_START, typeof ROAD_END] = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    ];
    const multiSegmentRoute = [...farSegment, ...ROAD];
    expect(distanceToPolyline(ROAD_START, multiSegmentRoute)).toBeLessThan(1);
  });

  it('returns Infinity for an empty polyline', () => {
    expect(distanceToPolyline(ROAD_START, [])).toBe(Number.POSITIVE_INFINITY);
  });

  it('falls back to point distance for a single-point polyline', () => {
    expect(distanceToPolyline(ROAD_END, [ROAD_START])).toBeCloseTo(
      distanceToPolyline(ROAD_END, [ROAD_START, ROAD_START]),
      3
    );
  });
});

describe('nearestPointOnPolyline', () => {
  it('returns the polyline point itself for a point on the route', () => {
    const snapped = nearestPointOnPolyline(ROAD_START, ROAD);
    expect(snapped.latitude).toBeCloseTo(ROAD_START.latitude, 6);
    expect(snapped.longitude).toBeCloseTo(ROAD_START.longitude, 6);
  });

  it('projects onto the segment rather than the nearest vertex', () => {
    // A point beside the road's midpoint should snap back to the midpoint,
    // not to either endpoint.
    const offToTheSide = {
      latitude: (ROAD_START.latitude + ROAD_END.latitude) / 2,
      longitude: ROAD_START.longitude + 0.001,
    };
    const snapped = nearestPointOnPolyline(offToTheSide, ROAD);
    expect(snapped.latitude).toBeCloseTo(offToTheSide.latitude, 5);
    expect(snapped.longitude).toBeCloseTo(ROAD_START.longitude, 5);
    // And the snapped point is genuinely on the route.
    expect(distanceToPolyline(snapped, ROAD)).toBeLessThan(1);
  });

  it('clamps to the nearest endpoint for a point beyond the segment', () => {
    const wayPastTheEnd = { latitude: ROAD_END.latitude + 1, longitude: ROAD_END.longitude };
    const snapped = nearestPointOnPolyline(wayPastTheEnd, ROAD);
    expect(snapped.latitude).toBeCloseTo(ROAD_END.latitude, 6);
    expect(snapped.longitude).toBeCloseTo(ROAD_END.longitude, 6);
  });

  it('snaps to the closest of several segments, not just the nearest vertex', () => {
    // An L-shaped route; a point inside the corner is closer to the second
    // segment's span than to any vertex.
    const corner = { latitude: -34.92, longitude: 138.6 };
    const lRoute = [
      { latitude: -34.93, longitude: 138.6 },
      corner,
      { latitude: -34.92, longitude: 138.61 },
    ];
    const insideCorner = { latitude: -34.9205, longitude: 138.605 };
    const snapped = nearestPointOnPolyline(insideCorner, lRoute);
    expect(distanceToPolyline(snapped, lRoute)).toBeLessThan(1);
    // Snapped onto the east-running segment (a projection near the point's
    // own longitude), not onto the corner vertex itself.
    expect(snapped.longitude).not.toBeCloseTo(corner.longitude, 6);
    expect(snapped.longitude).toBeCloseTo(insideCorner.longitude, 5);
  });

  it('returns the point unchanged for an empty polyline', () => {
    expect(nearestPointOnPolyline(ROAD_START, [])).toEqual(ROAD_START);
  });

  it('returns the single point for a single-point polyline', () => {
    expect(nearestPointOnPolyline(ROAD_END, [ROAD_START])).toEqual(ROAD_START);
  });
});
