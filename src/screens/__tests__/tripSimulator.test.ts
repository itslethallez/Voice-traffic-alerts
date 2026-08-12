import { haversineDistance } from '../../geo/distance';
import { advanceSimulatedDriver, initialSimulatedDriver } from '../tripSimulator';

describe('advanceSimulatedDriver', () => {
  it('does not move for a zero or negative elapsed time', () => {
    const driver = advanceSimulatedDriver(initialSimulatedDriver, 0);
    expect(driver.position).toEqual(initialSimulatedDriver.position);
  });

  it('advances roughly speed * time forward along the heading', () => {
    const oneMinuteMs = 60_000;
    const next = advanceSimulatedDriver(initialSimulatedDriver, oneMinuteMs);

    const expectedMeters = ((initialSimulatedDriver.speedKmh * 1000) / 3600) * 60;
    const actualMeters = haversineDistance(initialSimulatedDriver.position, next.position);

    expect(actualMeters).toBeCloseTo(expectedMeters, 0);
  });

  it('keeps heading and speed unchanged', () => {
    const next = advanceSimulatedDriver(initialSimulatedDriver, 5000);
    expect(next.headingDeg).toBe(initialSimulatedDriver.headingDeg);
    expect(next.speedKmh).toBe(initialSimulatedDriver.speedKmh);
  });
});
