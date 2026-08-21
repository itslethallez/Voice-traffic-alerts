import { zoomForRingRadius } from '../mercatorZoom';

const ADELAIDE_LATITUDE = -34.9;
const RING_RADIUS_PX = 130;

describe('zoomForRingRadius', () => {
  it('zooms in further for a smaller real-world distance at the same ring size', () => {
    const zoomForClose = zoomForRingRadius(500, RING_RADIUS_PX, ADELAIDE_LATITUDE);
    const zoomForFar = zoomForRingRadius(5000, RING_RADIUS_PX, ADELAIDE_LATITUDE);
    expect(zoomForClose).toBeGreaterThan(zoomForFar);
  });

  it('zooms in further for a larger ring radius at the same distance', () => {
    const zoomForSmallRing = zoomForRingRadius(5000, 65, ADELAIDE_LATITUDE);
    const zoomForLargeRing = zoomForRingRadius(5000, 260, ADELAIDE_LATITUDE);
    expect(zoomForLargeRing).toBeGreaterThan(zoomForSmallRing);
  });

  it('matches the Web Mercator formula at the equator', () => {
    // At lat 0, cos(lat) = 1, so metersPerPixel = 156543.03392 / 2^zoom.
    // Solving for zoom directly at a round distance/radius keeps this an
    // independent check rather than re-deriving the implementation.
    const zoom = zoomForRingRadius(1000, 100, 0);
    const metersPerPixel = 156543.03392 / 2 ** zoom;
    expect(metersPerPixel * 100).toBeCloseTo(1000, 5);
  });

  it('clamps to a minimum zoom for an extreme (very large) distance', () => {
    expect(zoomForRingRadius(20_000_000, RING_RADIUS_PX, ADELAIDE_LATITUDE)).toBe(3);
  });

  it('clamps to a maximum zoom for an extreme (very small) distance', () => {
    expect(zoomForRingRadius(1, RING_RADIUS_PX, ADELAIDE_LATITUDE)).toBe(18);
  });
});
