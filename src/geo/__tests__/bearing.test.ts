import { bearingBetween, bearingDifference, signedBearingOffset } from '../bearing';

// All coordinates are Adelaide-area (lat approx -34.9, southern hemisphere).
const ORIGIN = { latitude: -34.9, longitude: 138.6 };
const NORTH_OF_ORIGIN = { latitude: -34.89, longitude: 138.6 };
const EAST_OF_ORIGIN = { latitude: -34.9, longitude: 138.61 };
const SOUTH_OF_ORIGIN = { latitude: -34.91, longitude: 138.6 };
const WEST_OF_ORIGIN = { latitude: -34.9, longitude: 138.59 };

const ADELAIDE_RAILWAY_STATION = { latitude: -34.92168, longitude: 138.59739 };
const ADELAIDE_OVAL = { latitude: -34.9155556, longitude: 138.5961111 };

describe('bearingBetween', () => {
  it('points north as ~0 degrees', () => {
    expect(bearingBetween(ORIGIN, NORTH_OF_ORIGIN)).toBeCloseTo(0, 3);
  });

  it('points east as ~90 degrees', () => {
    expect(bearingBetween(ORIGIN, EAST_OF_ORIGIN)).toBeCloseTo(90.00286, 3);
  });

  it('points south as ~180 degrees', () => {
    expect(bearingBetween(ORIGIN, SOUTH_OF_ORIGIN)).toBeCloseTo(180, 3);
  });

  it('points west as ~270 degrees', () => {
    expect(bearingBetween(ORIGIN, WEST_OF_ORIGIN)).toBeCloseTo(269.99714, 3);
  });

  it('always returns a value in [0, 360)', () => {
    for (const target of [NORTH_OF_ORIGIN, EAST_OF_ORIGIN, SOUTH_OF_ORIGIN, WEST_OF_ORIGIN]) {
      const bearing = bearingBetween(ORIGIN, target);
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    }
  });

  it('the reverse bearing between two real Adelaide landmarks is ~180 degrees away from the forward bearing', () => {
    const forward = bearingBetween(ADELAIDE_RAILWAY_STATION, ADELAIDE_OVAL);
    const backward = bearingBetween(ADELAIDE_OVAL, ADELAIDE_RAILWAY_STATION);
    const diff = Math.abs(forward - backward);
    expect(Math.min(diff, 360 - diff)).toBeCloseTo(180, 1);
  });
});

describe('bearingDifference', () => {
  it('handles the 0/360 seam going forward: heading 350, bearing 10 is 20 degrees, not 340', () => {
    expect(bearingDifference(350, 10)).toBe(20);
  });

  it('handles the 0/360 seam going backward: heading 10, bearing 350 is 20 degrees, not 340', () => {
    expect(bearingDifference(10, 350)).toBe(20);
  });

  it('is 0 for identical heading and bearing', () => {
    expect(bearingDifference(45, 45)).toBe(0);
  });

  it('is 180 for opposite heading and bearing', () => {
    expect(bearingDifference(0, 180)).toBe(180);
    expect(bearingDifference(90, 270)).toBe(180);
  });

  it('never exceeds 180', () => {
    for (let heading = 0; heading < 360; heading += 15) {
      for (let bearing = 0; bearing < 360; bearing += 15) {
        expect(bearingDifference(heading, bearing)).toBeLessThanOrEqual(180);
        expect(bearingDifference(heading, bearing)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('signedBearingOffset', () => {
  it('is positive (right) for a bearing clockwise of the heading', () => {
    expect(signedBearingOffset(0, 90)).toBeCloseTo(90);
  });

  it('is negative (left) for a bearing counter-clockwise of the heading', () => {
    expect(signedBearingOffset(0, 270)).toBeCloseTo(-90);
  });

  it('is 0 for identical heading and bearing', () => {
    expect(signedBearingOffset(45, 45)).toBeCloseTo(0);
  });

  it('handles the 0/360 seam going right: heading 350, bearing 10 is +20, not -340', () => {
    expect(signedBearingOffset(350, 10)).toBeCloseTo(20);
  });

  it('handles the 0/360 seam going left: heading 10, bearing 350 is -20, not +340', () => {
    expect(signedBearingOffset(10, 350)).toBeCloseTo(-20);
  });

  it('the magnitude always matches bearingDifference', () => {
    for (let heading = 0; heading < 360; heading += 15) {
      for (let bearing = 0; bearing < 360; bearing += 15) {
        expect(Math.abs(signedBearingOffset(heading, bearing))).toBeCloseTo(bearingDifference(heading, bearing));
      }
    }
  });
});
