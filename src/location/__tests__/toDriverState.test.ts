import { toDriverState } from '../toDriverState';
import type { DriverState } from '../../engine/types';

const ADELAIDE = { latitude: -34.9, longitude: 138.6 };
const NORTH_OF_ADELAIDE = { latitude: -34.89, longitude: 138.6 };

describe('toDriverState', () => {
  it('converts speed from m/s to km/h', () => {
    const driver = toDriverState(
      { latitude: ADELAIDE.latitude, longitude: ADELAIDE.longitude, heading: 90, speed: 10 },
      null
    );
    expect(driver.speedKmh).toBeCloseTo(36, 5);
  });

  it('treats a null speed as stationary rather than throwing', () => {
    const driver = toDriverState(
      { latitude: ADELAIDE.latitude, longitude: ADELAIDE.longitude, heading: 90, speed: null },
      null
    );
    expect(driver.speedKmh).toBe(0);
  });

  it('clamps a negative speed reading to zero', () => {
    const driver = toDriverState(
      { latitude: ADELAIDE.latitude, longitude: ADELAIDE.longitude, heading: 90, speed: -1 },
      null
    );
    expect(driver.speedKmh).toBe(0);
  });

  it('uses the reported heading when available', () => {
    const driver = toDriverState(
      { latitude: ADELAIDE.latitude, longitude: ADELAIDE.longitude, heading: 123, speed: 5 },
      null
    );
    expect(driver.headingDeg).toBe(123);
  });

  it('falls back to the bearing from the previous position when heading is null', () => {
    const previous: DriverState = { position: ADELAIDE, headingDeg: 200, speedKmh: 10 };
    const driver = toDriverState(
      { latitude: NORTH_OF_ADELAIDE.latitude, longitude: NORTH_OF_ADELAIDE.longitude, heading: null, speed: 5 },
      previous
    );
    expect(driver.headingDeg).toBeCloseTo(0, 3); // NORTH_OF_ADELAIDE is due north of ADELAIDE
  });

  it('falls back to the bearing from the previous position when heading is -1 (unknown sentinel)', () => {
    const previous: DriverState = { position: ADELAIDE, headingDeg: 200, speedKmh: 10 };
    const driver = toDriverState(
      { latitude: NORTH_OF_ADELAIDE.latitude, longitude: NORTH_OF_ADELAIDE.longitude, heading: -1, speed: 5 },
      previous
    );
    expect(driver.headingDeg).toBeCloseTo(0, 3);
  });

  it('keeps the previous heading when position has not changed and heading is unknown', () => {
    const previous: DriverState = { position: ADELAIDE, headingDeg: 200, speedKmh: 0 };
    const driver = toDriverState(
      { latitude: ADELAIDE.latitude, longitude: ADELAIDE.longitude, heading: null, speed: 0 },
      previous
    );
    expect(driver.headingDeg).toBe(200);
  });

  it('defaults to 0 when heading is unknown and there is no previous position', () => {
    const driver = toDriverState(
      { latitude: ADELAIDE.latitude, longitude: ADELAIDE.longitude, heading: null, speed: 0 },
      null
    );
    expect(driver.headingDeg).toBe(0);
  });
});
