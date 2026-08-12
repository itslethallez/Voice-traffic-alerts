import { boundingBox } from '../../geo/boundingBox';
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

describe('planPoll', () => {
  it('plans a moving poll with the ahead-facing box when speed is at or above the stationary threshold', () => {
    const driver: DriverState = { position: ADELAIDE_POSITION, headingDeg: 45, speedKmh: 60 };
    const movement = updateMovementState(initialMovementState, ADELAIDE_POSITION, 0);

    const plan = planPoll(driver, movement, 0);

    expect(plan.shouldPoll).toBe(true);
    expect(plan.reason).toBe('moving');
    expect(plan.intervalMs).toBe(MOVING_POLL_INTERVAL_MS);
    expect(plan.boundingBox).toEqual(
      boundingBox(ADELAIDE_POSITION, 45, MOVING_BOX_AHEAD_M, MOVING_BOX_SIDE_M)
    );
  });

  it('plans a stationary poll with the radius box when speed is under the stationary threshold', () => {
    const driver: DriverState = { position: ADELAIDE_POSITION, headingDeg: 45, speedKmh: 2 };
    const movement = updateMovementState(initialMovementState, ADELAIDE_POSITION, 0);

    const plan = planPoll(driver, movement, 0);

    expect(plan.shouldPoll).toBe(true);
    expect(plan.reason).toBe('stationary');
    expect(plan.intervalMs).toBe(STATIONARY_POLL_INTERVAL_MS);
    expect(plan.boundingBox).toEqual(radiusBoundingBox(ADELAIDE_POSITION, STATIONARY_BOX_RADIUS_M));
  });

  it('pauses entirely once there has been no location change for 15 minutes, regardless of speed', () => {
    const driver: DriverState = { position: ADELAIDE_POSITION, headingDeg: 45, speedKmh: 60 };
    const movement = updateMovementState(initialMovementState, ADELAIDE_POSITION, 0);

    const plan = planPoll(driver, movement, 15 * 60_000);

    expect(plan.shouldPoll).toBe(false);
    expect(plan.reason).toBe('paused');
    expect(plan.boundingBox).toBeNull();
  });
});
