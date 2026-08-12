import { haversineDistance } from '../distance';

/**
 * Adelaide Railway Station (tram stop node, OpenStreetMap) and Adelaide
 * Oval (Wikipedia infobox coordinates, 34°54'56"S 138°35'46"E). The
 * expected distance below was computed independently with Vincenty's
 * ellipsoidal inverse formula (not haversine) for these two coordinate
 * pairs: 689.41m. haversineDistance uses a spherical-earth approximation,
 * so it won't match the ellipsoidal figure exactly, but at this short a
 * range (~700m) the two should agree to within a couple of metres -
 * comfortably inside the 10m tolerance below.
 */
const ADELAIDE_RAILWAY_STATION = { latitude: -34.92168, longitude: 138.59739 };
const ADELAIDE_OVAL = { latitude: -34.9155556, longitude: 138.5961111 };
const KNOWN_DISTANCE_M = 689.41;

describe('haversineDistance', () => {
  it('matches the independently-computed distance between two Adelaide landmarks to within 10m', () => {
    const distance = haversineDistance(ADELAIDE_RAILWAY_STATION, ADELAIDE_OVAL);
    expect(Math.abs(distance - KNOWN_DISTANCE_M)).toBeLessThan(10);
  });

  it('is symmetric', () => {
    const forward = haversineDistance(ADELAIDE_RAILWAY_STATION, ADELAIDE_OVAL);
    const backward = haversineDistance(ADELAIDE_OVAL, ADELAIDE_RAILWAY_STATION);
    expect(forward).toBeCloseTo(backward, 6);
  });

  it('is zero for the same point', () => {
    expect(haversineDistance(ADELAIDE_OVAL, ADELAIDE_OVAL)).toBe(0);
  });
});
