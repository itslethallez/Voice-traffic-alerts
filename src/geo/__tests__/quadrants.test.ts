import { splitBoundingBoxIntoQuadrants } from '../quadrants';

function parseCorner(corner: string): { latitude: number; longitude: number } {
  const [latitude, longitude] = corner.split(',').map(Number);
  return { latitude, longitude };
}

describe('splitBoundingBoxIntoQuadrants', () => {
  const box = { bottom_left: '-35.0,138.0', top_right: '-34.0,139.0' };

  it('produces exactly four quadrants', () => {
    expect(splitBoundingBoxIntoQuadrants(box)).toHaveLength(4);
  });

  it('together, the quadrants span exactly the original box', () => {
    const quadrants = splitBoundingBoxIntoQuadrants(box);
    const allCorners = quadrants.flatMap((q) => [parseCorner(q.bottom_left), parseCorner(q.top_right)]);

    const minLat = Math.min(...allCorners.map((c) => c.latitude));
    const maxLat = Math.max(...allCorners.map((c) => c.latitude));
    const minLon = Math.min(...allCorners.map((c) => c.longitude));
    const maxLon = Math.max(...allCorners.map((c) => c.longitude));

    expect(minLat).toBeCloseTo(-35.0, 9);
    expect(maxLat).toBeCloseTo(-34.0, 9);
    expect(minLon).toBeCloseTo(138.0, 9);
    expect(maxLon).toBeCloseTo(139.0, 9);
  });

  it('each quadrant meets at the midpoint', () => {
    const quadrants = splitBoundingBoxIntoQuadrants(box);
    const midLat = -34.5;
    const midLon = 138.5;

    for (const quadrant of quadrants) {
      const bl = parseCorner(quadrant.bottom_left);
      const tr = parseCorner(quadrant.top_right);
      expect(bl.latitude === -35.0 || bl.latitude === midLat).toBe(true);
      expect(tr.latitude === midLat || tr.latitude === -34.0).toBe(true);
      expect(bl.longitude === 138.0 || bl.longitude === midLon).toBe(true);
      expect(tr.longitude === midLon || tr.longitude === 139.0).toBe(true);
    }
  });

  it('each quadrant is a quarter of the original box in degree-space', () => {
    const quadrants = splitBoundingBoxIntoQuadrants(box);
    for (const quadrant of quadrants) {
      const bl = parseCorner(quadrant.bottom_left);
      const tr = parseCorner(quadrant.top_right);
      expect(tr.latitude - bl.latitude).toBeCloseTo(0.5, 9);
      expect(tr.longitude - bl.longitude).toBeCloseTo(0.5, 9);
    }
  });
});
