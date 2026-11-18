import { initialSpeedState, isSustainedLowSpeed, updateSpeedState } from '../speedGate';
import { SUSTAINED_LOW_SPEED_WINDOW_MS } from '../constants';

describe('updateSpeedState', () => {
  it('clears the tracker once speed is at or above the threshold', () => {
    const below = updateSpeedState(initialSpeedState, 10, 1000);
    const atThreshold = updateSpeedState(below, 15, 2000);
    expect(atThreshold.belowThresholdSinceMs).toBeNull();
  });

  it('records when speed first drops below the threshold', () => {
    const next = updateSpeedState(initialSpeedState, 10, 1000);
    expect(next.belowThresholdSinceMs).toBe(1000);
  });

  it('does not reset the timestamp while speed stays below the threshold', () => {
    const first = updateSpeedState(initialSpeedState, 10, 1000);
    const second = updateSpeedState(first, 8, 5000);
    expect(second.belowThresholdSinceMs).toBe(1000);
  });
});

describe('isSustainedLowSpeed', () => {
  it('is false if speed has never dropped below the threshold', () => {
    expect(isSustainedLowSpeed(initialSpeedState, 999999)).toBe(false);
  });

  it('is false just under the sustained window', () => {
    const state = updateSpeedState(initialSpeedState, 10, 0);
    expect(isSustainedLowSpeed(state, SUSTAINED_LOW_SPEED_WINDOW_MS - 1)).toBe(false);
  });

  it('is true at exactly the sustained window', () => {
    const state = updateSpeedState(initialSpeedState, 10, 0);
    expect(isSustainedLowSpeed(state, SUSTAINED_LOW_SPEED_WINDOW_MS)).toBe(true);
  });
});
