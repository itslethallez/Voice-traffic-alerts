import { ANNOUNCE_MAX_BEARING_DIFF_DEG } from '../../geo/announceWindow';
import { boundingBox } from '../../geo/boundingBox';
import { destinationPoint } from '../../geo/destination';
import { radiusBoundingBox } from '../../geo/radiusBoundingBox';
import {
  MOVING_BOX_AHEAD_M,
  MOVING_BOX_SIDE_M,
  MOVING_POLL_INTERVAL_MS,
  STATIONARY_BOX_RADIUS_M,
  STATIONARY_POLL_INTERVAL_MS,
} from '../constants';
import { initialMovementState, updateMovementState } from '../movement';
import { planPoll } from '../pollPlanner';
import type { DriverState } from '../types';

const ADELAIDE_POSITION = { latitude: -34.9, longitude: 138.6 };

/** Mirrors pollPlanner's own real-geometry calculation - a fixed ratio
 * of aheadM (what the code used to do) doesn't track this unless the
 * ratio happens to equal sin(ANNOUNCE_MAX_BEARING_DIFF_DEG). */
function expectedSideM(aheadM: number): number {
  const rad = (ANNOUNCE_MAX_BEARING_DIFF_DEG * Math.PI) / 180;
  return Math.max(MOVING_BOX_SIDE_M, Math.ceil(aheadM * Math.sin(rad)));
}

describe('planPoll', () => {
  it('plans a moving poll with the ahead-facing box when speed is at or above the stationary threshold', () => {
    const driver: DriverState = { position: ADELAIDE_POSITION, headingDeg: 45, speedKmh: 60 };
    const movement = updateMovementState(initialMovementState, ADELAIDE_POSITION, 0);

    const plan = planPoll(driver, movement, 0, 2000);

    expect(plan.shouldPoll).toBe(true);
    expect(plan.reason).toBe('moving');
    expect(plan.intervalMs).toBe(MOVING_POLL_INTERVAL_MS);
    expect(plan.boundingBox).toEqual(
      boundingBox(ADELAIDE_POSITION, 45, MOVING_BOX_AHEAD_M, expectedSideM(MOVING_BOX_AHEAD_M))
    );
  });

  it('plans a stationary poll with the radius box when speed is under the stationary threshold', () => {
    const driver: DriverState = { position: ADELAIDE_POSITION, headingDeg: 45, speedKmh: 2 };
    const movement = updateMovementState(initialMovementState, ADELAIDE_POSITION, 0);

    const plan = planPoll(driver, movement, 0, 2000);

    expect(plan.shouldPoll).toBe(true);
    expect(plan.reason).toBe('stationary');
    expect(plan.intervalMs).toBe(STATIONARY_POLL_INTERVAL_MS);
    expect(plan.boundingBox).toEqual(radiusBoundingBox(ADELAIDE_POSITION, STATIONARY_BOX_RADIUS_M));
  });

  it('pauses entirely once there has been no location change for 15 minutes, regardless of speed', () => {
    const driver: DriverState = { position: ADELAIDE_POSITION, headingDeg: 45, speedKmh: 60 };
    const movement = updateMovementState(initialMovementState, ADELAIDE_POSITION, 0);

    const plan = planPoll(driver, movement, 15 * 60_000, 2000);

    expect(plan.shouldPoll).toBe(false);
    expect(plan.reason).toBe('paused');
    expect(plan.boundingBox).toBeNull();
  });

  it('widens the moving box - ahead, and side to match the real 45-degree cone - when the announce distance exceeds it', () => {
    const driver: DriverState = { position: ADELAIDE_POSITION, headingDeg: 45, speedKmh: 60 };
    const movement = updateMovementState(initialMovementState, ADELAIDE_POSITION, 0);

    const plan = planPoll(driver, movement, 0, 20_000);

    expect(plan.boundingBox).toEqual(
      boundingBox(ADELAIDE_POSITION, 45, 20_000, expectedSideM(20_000))
    );
  });

  it('does not shrink the moving box below its default size when the announce distance is smaller', () => {
    const driver: DriverState = { position: ADELAIDE_POSITION, headingDeg: 45, speedKmh: 60 };
    const movement = updateMovementState(initialMovementState, ADELAIDE_POSITION, 0);

    const plan = planPoll(driver, movement, 0, 500);

    expect(plan.boundingBox).toEqual(
      boundingBox(ADELAIDE_POSITION, 45, MOVING_BOX_AHEAD_M, expectedSideM(MOVING_BOX_AHEAD_M))
    );
  });

  it('the moving box actually contains an alert at the full bearing tolerance and the configured announce distance', () => {
    // Direct regression for the geometry bug Bugbot caught: scaling
    // sideM by a fixed ratio of aheadM (instead of real trigonometry)
    // left alerts near the edge of the accepted 45-degree cone outside
    // the fetch box, so they'd never reach the cache in the first place.
    const driver: DriverState = { position: ADELAIDE_POSITION, headingDeg: 0, speedKmh: 60 };
    const movement = updateMovementState(initialMovementState, ADELAIDE_POSITION, 0);
    const announceDistanceMeters = 20_000;

    const plan = planPoll(driver, movement, 0, announceDistanceMeters);
    const worstCaseAlert = destinationPoint(
      ADELAIDE_POSITION,
      announceDistanceMeters,
      ANNOUNCE_MAX_BEARING_DIFF_DEG
    );

    const [bottomLat, bottomLon] = plan.boundingBox!.bottom_left.split(',').map(Number);
    const [topLat, topLon] = plan.boundingBox!.top_right.split(',').map(Number);

    expect(worstCaseAlert.latitude).toBeGreaterThanOrEqual(bottomLat);
    expect(worstCaseAlert.latitude).toBeLessThanOrEqual(topLat);
    expect(worstCaseAlert.longitude).toBeGreaterThanOrEqual(bottomLon);
    expect(worstCaseAlert.longitude).toBeLessThanOrEqual(topLon);
  });

  it('widens the stationary radius when the announce distance exceeds it, and never shrinks it', () => {
    const driver: DriverState = { position: ADELAIDE_POSITION, headingDeg: 45, speedKmh: 2 };
    const movement = updateMovementState(initialMovementState, ADELAIDE_POSITION, 0);

    const widened = planPoll(driver, movement, 0, 20_000);
    expect(widened.boundingBox).toEqual(radiusBoundingBox(ADELAIDE_POSITION, 20_000));

    const notShrunk = planPoll(driver, movement, 0, 500);
    expect(notShrunk.boundingBox).toEqual(radiusBoundingBox(ADELAIDE_POSITION, STATIONARY_BOX_RADIUS_M));
  });
});
