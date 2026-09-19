import { boundingBox } from '../boundingBox';
import { haversineDistance } from '../distance';

// Adelaide-area reference position (lat approx -34.9, southern hemisphere).
const ADELAIDE_POSITION = { latitude: -34.9, longitude: 138.6 };

function parseCorner(corner: string): { latitude: number; longitude: number } {
  const [first, second] = corner.split(',').map(Number);
  return { latitude: first, longitude: second };
}

describe('boundingBox', () => {
  it('formats corners as "lat,lon", not "lon,lat"', () => {
    // Confirmed against real sample requests/responses from the
    // alerts-and-jams endpoint (see README's "Waze API" section):
    // e.g. bottom_left "40.666...,-74.137..." for a New York City box,
    // where 40.66 is clearly the latitude and -74.13 the longitude.
    // Getting this order backwards doesn't error, it silently returns
    // an empty alerts array - so we pin it here.
    const box = boundingBox(ADELAIDE_POSITION, 0, 1000, 500);
    const bottomLeft = parseCorner(box.bottom_left);
    const topRight = parseCorner(box.top_right);

    // Adelaide's latitude is close to -34.9; its longitude is close to
    // 138.6. Those magnitudes are different enough that a lat/lon swap
    // is unambiguous.
    for (const corner of [bottomLeft, topRight]) {
      expect(corner.latitude).toBeLessThan(-30);
      expect(corner.latitude).toBeGreaterThan(-40);
      expect(corner.longitude).toBeGreaterThan(130);
      expect(corner.longitude).toBeLessThan(145);
    }
  });

  it('produces an east-west span of the correct width in metres, not a naive degree offset', () => {
    const sideM = 1500;
    const box = boundingBox(ADELAIDE_POSITION, 0, 1000, sideM);
    const bottomLeft = parseCorner(box.bottom_left);
    const topRight = parseCorner(box.top_right);

    const eastWestSpanMeters = haversineDistance(
      { latitude: ADELAIDE_POSITION.latitude, longitude: bottomLeft.longitude },
      { latitude: ADELAIDE_POSITION.latitude, longitude: topRight.longitude }
    );

    // Heading is due north, so the east-west span should be ~2 * sideM.
    expect(eastWestSpanMeters).toBeGreaterThan(2 * sideM - 5);
    expect(eastWestSpanMeters).toBeLessThan(2 * sideM + 5);

    // A naive implementation that applies the same degrees-per-metre
    // conversion to longitude as it does to latitude (ignoring the
    // cos(latitude) correction) would produce a box roughly 20%
    // narrower than intended at this latitude - assert we are nowhere
    // near that number.
    const naiveUncorrectedSpanMeters =
      2 * sideM * Math.cos((ADELAIDE_POSITION.latitude * Math.PI) / 180);
    expect(Math.abs(eastWestSpanMeters - naiveUncorrectedSpanMeters)).toBeGreaterThan(400);
  });

  it('produces a north-south span of the correct length in metres', () => {
    const aheadM = 5000;
    const box = boundingBox(ADELAIDE_POSITION, 0, aheadM, 100);
    const bottomLeft = parseCorner(box.bottom_left);
    const topRight = parseCorner(box.top_right);

    const northSouthSpanMeters = haversineDistance(
      { latitude: bottomLeft.latitude, longitude: ADELAIDE_POSITION.longitude },
      { latitude: topRight.latitude, longitude: ADELAIDE_POSITION.longitude }
    );

    expect(northSouthSpanMeters).toBeGreaterThan(aheadM - 5);
    expect(northSouthSpanMeters).toBeLessThan(aheadM + 5);
  });
});
