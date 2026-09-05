import type { WazeAlert, WazeAlertType } from '../../api/waze/types';
import { destinationPoint } from '../../geo/destination';
import type { GeoPoint } from '../../geo/types';
import type { AnnounceableAlert } from '../types';
import { dedupeNearbyAlerts, DUPLICATE_CLUSTER_RADIUS_M } from '../dedupeNearbyAlerts';

const DRIVER_POSITION: GeoPoint = { latitude: -34.9, longitude: 138.6 };
/** Driver heading due north - "along the road" is bearing 0/180, "across
 * the road" (the opposite-carriageway direction) is bearing 90/270. */
const DRIVER_HEADING_DEG = 0;
const BASE_POSITION = destinationPoint(DRIVER_POSITION, 800, 0); // 800m ahead of the driver

/**
 * Places a point relative to BASE_POSITION: `alongMeters` further in the
 * driver's direction of travel (can be negative), `acrossMeters`
 * perpendicular to it (the "opposite carriageway" direction). Two chained
 * destinationPoint calls rather than one distance+bearing-from-driver pair
 * - the latter conflates radial and tangential offsets in a way that
 * doesn't let a test control "parallel to heading" vs "perpendicular to
 * heading" precisely (verified numerically while writing this file: a
 * naive small bearing-from-driver difference can produce a between-point
 * bearing that's mostly *tangential*, not radial, once distance is also
 * slightly different - the opposite of what it looks like it should do).
 */
function offsetFromBase(alongMeters: number, acrossMeters: number): GeoPoint {
  const along = destinationPoint(BASE_POSITION, alongMeters, DRIVER_HEADING_DEG);
  return destinationPoint(along, acrossMeters, DRIVER_HEADING_DEG + 90);
}

let nextId = 0;

function makeCandidateAt(
  position: GeoPoint,
  overrides: Partial<WazeAlert> & { type?: WazeAlertType } = {}
): AnnounceableAlert {
  nextId += 1;
  const alert: WazeAlert = {
    alert_id: `dedupe-test-${nextId}`,
    type: 'POLICE',
    subtype: null,
    reported_by: null,
    description: null,
    image: null,
    publish_datetime_utc: '2026-01-01T00:00:00.000Z',
    country: 'AU',
    city: 'Adelaide',
    street: 'Test St',
    latitude: position.latitude,
    longitude: position.longitude,
    num_thumbs_up: 0,
    alert_reliability: 0,
    alert_confidence: 0,
    near_by: null,
    comments: [],
    num_comments: 0,
    ...overrides,
  };
  return {
    alert,
    distanceMeters: 800,
    bearingDeg: 0,
    bearingDiffDeg: 0,
    ageMinutes: 3,
    driverHeadingDeg: DRIVER_HEADING_DEG,
  };
}

describe('dedupeNearbyAlerts', () => {
  it('merges two same-type alerts close together and along the direction of travel', () => {
    const a = makeCandidateAt(offsetFromBase(0, 0), { alert_reliability: 8, num_thumbs_up: 4 });
    const b = makeCandidateAt(offsetFromBase(80, 0), { alert_reliability: 9, num_thumbs_up: 8 }); // 80m further along - same "lane"

    const result = dedupeNearbyAlerts([a, b], DRIVER_HEADING_DEG);

    expect(result).toHaveLength(1);
    expect(result[0].alert.alert_id).toBe(b.alert.alert_id); // more corroborated survives
  });

  it('merges two same-type alerts close enough together that bearing is not a meaningful signal, even directly across the driver heading (same-spot bypass)', () => {
    // Regression test: bearingBetween on near-identical coordinates is
    // dominated by GPS/rounding noise, not real geometry - two reporters
    // describing the exact same incident from ~15m apart used to fail the
    // parallel-bearing check whenever that noise happened to land roughly
    // perpendicular to the driver's heading, leaving genuine duplicates
    // unmerged.
    const a = makeCandidateAt(offsetFromBase(0, 0), { alert_reliability: 8 });
    const b = makeCandidateAt(offsetFromBase(0, 15), { alert_reliability: 9 }); // 15m across - same real-world spot

    const result = dedupeNearbyAlerts([a, b], DRIVER_HEADING_DEG);

    expect(result).toHaveLength(1);
    expect(result[0].alert.alert_id).toBe(b.alert.alert_id);
  });

  it('still applies the carriageway/bearing check once alerts are far enough apart for bearing to be meaningful', () => {
    const a = makeCandidateAt(offsetFromBase(0, 0), { alert_reliability: 8 });
    const b = makeCandidateAt(offsetFromBase(0, 100), { alert_reliability: 9 }); // well past the same-spot bypass radius

    const result = dedupeNearbyAlerts([a, b], DRIVER_HEADING_DEG);

    expect(result).toHaveLength(2);
  });

  it('does NOT merge two same-type alerts close together but across the road (opposite carriageway)', () => {
    const a = makeCandidateAt(offsetFromBase(0, 0), { alert_reliability: 8 });
    const b = makeCandidateAt(offsetFromBase(0, 300), { alert_reliability: 8 }); // 300m across, not along

    const result = dedupeNearbyAlerts([a, b], DRIVER_HEADING_DEG);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.alert.alert_id).sort()).toEqual(
      [a.alert.alert_id, b.alert.alert_id].sort()
    );
  });

  it('does not merge two same-type alerts further apart (along the road) than the cluster radius', () => {
    const a = makeCandidateAt(offsetFromBase(0, 0));
    const b = makeCandidateAt(offsetFromBase(DUPLICATE_CLUSTER_RADIUS_M + 200, 0));

    const result = dedupeNearbyAlerts([a, b], DRIVER_HEADING_DEG);

    expect(result).toHaveLength(2);
  });

  it('never merges two alerts of different types, however close together', () => {
    const a = makeCandidateAt(offsetFromBase(0, 0), { type: 'POLICE' });
    const b = makeCandidateAt(offsetFromBase(20, 0), { type: 'HAZARD' });

    const result = dedupeNearbyAlerts([a, b], DRIVER_HEADING_DEG);

    expect(result).toHaveLength(2);
  });

  it('keeps the higher-reliability alert as the survivor', () => {
    const higher = makeCandidateAt(offsetFromBase(0, 0), { alert_reliability: 9, num_thumbs_up: 1 });
    const lower = makeCandidateAt(offsetFromBase(50, 0), { alert_reliability: 3, num_thumbs_up: 20 });

    const result = dedupeNearbyAlerts([lower, higher], DRIVER_HEADING_DEG);

    expect(result).toHaveLength(1);
    expect(result[0].alert.alert_id).toBe(higher.alert.alert_id);
  });

  it('falls back to thumbs-up when reliability ties', () => {
    const fewerThumbs = makeCandidateAt(offsetFromBase(0, 0), { alert_reliability: 5, num_thumbs_up: 1 });
    const moreThumbs = makeCandidateAt(offsetFromBase(50, 0), { alert_reliability: 5, num_thumbs_up: 9 });

    const result = dedupeNearbyAlerts([fewerThumbs, moreThumbs], DRIVER_HEADING_DEG);

    expect(result).toHaveLength(1);
    expect(result[0].alert.alert_id).toBe(moreThumbs.alert.alert_id);
  });

  it('leaves a lone alert with no nearby duplicate untouched', () => {
    const a = makeCandidateAt(offsetFromBase(0, 0));
    const result = dedupeNearbyAlerts([a], DRIVER_HEADING_DEG);
    expect(result).toEqual([a]);
  });

  it('returns an empty array for an empty input', () => {
    expect(dedupeNearbyAlerts([], DRIVER_HEADING_DEG)).toEqual([]);
  });

  it('accepts a custom radius', () => {
    const a = makeCandidateAt(offsetFromBase(0, 0));
    const b = makeCandidateAt(offsetFromBase(200, 0));

    expect(dedupeNearbyAlerts([a, b], DRIVER_HEADING_DEG, 100)).toHaveLength(2);
    expect(dedupeNearbyAlerts([a, b], DRIVER_HEADING_DEG, 300)).toHaveLength(1);
  });

  it('collapses a three-alert cluster (A near B, B near C) down to one', () => {
    const a = makeCandidateAt(offsetFromBase(-60, 0), { alert_reliability: 4 });
    const b = makeCandidateAt(offsetFromBase(0, 0), { alert_reliability: 9 }); // most trustworthy
    const c = makeCandidateAt(offsetFromBase(60, 0), { alert_reliability: 6 });

    const result = dedupeNearbyAlerts([a, b, c], DRIVER_HEADING_DEG);

    expect(result).toHaveLength(1);
    expect(result[0].alert.alert_id).toBe(b.alert.alert_id);
  });
});
