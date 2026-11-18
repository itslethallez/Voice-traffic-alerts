import { radiusBoundingBox } from '../radiusBoundingBox';
import { haversineDistance } from '../distance';

const ADELAIDE_POSITION = { latitude: -34.9, longitude: 138.6 };

function parseCorner(corner: string): { latitude: number; longitude: number } {
  const [first, second] = corner.split(',').map(Number);
  return { latitude: first, longitude: second };
}

describe('radiusBoundingBox', () => {
  it('produces a box whose north-south and east-west spans are both ~2 * radius in metres', () => {
    const radiusM = 2000;
    const box = radiusBoundingBox(ADELAIDE_POSITION, radiusM);
    const bottomLeft = parseCorner(box.bottom_left);
    const topRight = parseCorner(box.top_right);

    const northSouthSpanMeters = haversineDistance(
      { latitude: bottomLeft.latitude, longitude: ADELAIDE_POSITION.longitude },
      { latitude: topRight.latitude, longitude: ADELAIDE_POSITION.longitude }
    );
    const eastWestSpanMeters = haversineDistance(
      { latitude: ADELAIDE_POSITION.latitude, longitude: bottomLeft.longitude },
      { latitude: ADELAIDE_POSITION.latitude, longitude: topRight.longitude }
    );

    expect(northSouthSpanMeters).toBeGreaterThan(2 * radiusM - 5);
    expect(northSouthSpanMeters).toBeLessThan(2 * radiusM + 5);
    expect(eastWestSpanMeters).toBeGreaterThan(2 * radiusM - 5);
    expect(eastWestSpanMeters).toBeLessThan(2 * radiusM + 5);
  });

  it('centres the box on the position, not offset to one side', () => {
    const radiusM = 2000;
    const box = radiusBoundingBox(ADELAIDE_POSITION, radiusM);
    const bottomLeft = parseCorner(box.bottom_left);
    const topRight = parseCorner(box.top_right);

    const midLat = (bottomLeft.latitude + topRight.latitude) / 2;
    const midLon = (bottomLeft.longitude + topRight.longitude) / 2;

    expect(midLat).toBeCloseTo(ADELAIDE_POSITION.latitude, 3);
    expect(midLon).toBeCloseTo(ADELAIDE_POSITION.longitude, 3);
  });
});
