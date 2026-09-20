import { initialMovementState, isPausedForNoMovement, updateMovementState } from '../movement';
import { PAUSE_AFTER_NO_MOVEMENT_MS, SIGNIFICANT_MOVEMENT_THRESHOLD_M } from '../constants';

const ADELAIDE_POSITION = { latitude: -34.9, longitude: 138.6 };
// ~1m north - well under the 5m jitter floor.
const JITTER_POSITION = { latitude: -34.9 + 0.00001, longitude: 138.6 };
// ~1.1km north - a real move.
const MOVED_POSITION = { latitude: -34.89, longitude: 138.6 };

describe('updateMovementState', () => {
  it('records the first sample as a change', () => {
    const next = updateMovementState(initialMovementState, ADELAIDE_POSITION, 1000);
    expect(next.lastPosition).toEqual(ADELAIDE_POSITION);
    expect(next.lastChangedAtMs).toBe(1000);
  });

  it('does not update lastChangedAtMs for GPS-noise-sized movement', () => {
    const first = updateMovementState(initialMovementState, ADELAIDE_POSITION, 1000);
    const next = updateMovementState(first, JITTER_POSITION, 2000);
    expect(next.lastChangedAtMs).toBe(1000);
  });

  it('updates lastChangedAtMs for a real move past the jitter threshold', () => {
    const first = updateMovementState(initialMovementState, ADELAIDE_POSITION, 1000);
    const next = updateMovementState(first, MOVED_POSITION, 2000);
    expect(next.lastPosition).toEqual(MOVED_POSITION);
    expect(next.lastChangedAtMs).toBe(2000);
  });

  it('the jitter floor is exactly SIGNIFICANT_MOVEMENT_THRESHOLD_M', () => {
    expect(SIGNIFICANT_MOVEMENT_THRESHOLD_M).toBe(5);
  });
});

describe('isPausedForNoMovement', () => {
  it('is false before any position has been recorded', () => {
    expect(isPausedForNoMovement(initialMovementState, 0)).toBe(false);
  });

  it('is false just under the 15 minute window', () => {
    const state = updateMovementState(initialMovementState, ADELAIDE_POSITION, 0);
    expect(isPausedForNoMovement(state, PAUSE_AFTER_NO_MOVEMENT_MS - 1)).toBe(false);
  });

  it('is true at exactly the 15 minute window', () => {
    const state = updateMovementState(initialMovementState, ADELAIDE_POSITION, 0);
    expect(isPausedForNoMovement(state, PAUSE_AFTER_NO_MOVEMENT_MS)).toBe(true);
  });
});
