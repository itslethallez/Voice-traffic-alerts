import { awarenessCircleCoordinates, awarenessZoomLevel } from '../mapScale';
import { haversineDistance } from '../distance';

const ADELAIDE = { latitude: -34.9285, longitude: 138.6007 };

describe('awarenessCircleCoordinates', () => {
  it('draws a closed, metre-accurate circle around the driver', () => {
    const coordinates = awarenessCircleCoordinates(ADELAIDE, 5000, 8);

    expect(coordinates).toHaveLength(9);
    expect(coordinates[0]).toEqual(coordinates[coordinates.length - 1]);

    for (const [longitude, latitude] of coordinates.slice(0, -1)) {
      expect(haversineDistance(ADELAIDE, { latitude, longitude })).toBeCloseTo(5000, -1);
    }
  });
});

describe('awarenessZoomLevel', () => {
  it('zooms so the warning-distance diameter fits the requested viewport coverage', () => {
    const zoom = awarenessZoomLevel({
      latitude: ADELAIDE.latitude,
      radiusMeters: 5000,
      viewportWidth: 390,
      viewportHeight: 268,
      coverage: 0.78,
    });

    expect(zoom).toBeCloseTo(10.39, 1);
  });

  it('zooms out for a larger warning distance', () => {
    const nearZoom = awarenessZoomLevel({
      latitude: ADELAIDE.latitude,
      radiusMeters: 500,
      viewportWidth: 390,
      viewportHeight: 268,
    });
    const farZoom = awarenessZoomLevel({
      latitude: ADELAIDE.latitude,
      radiusMeters: 20000,
      viewportWidth: 390,
      viewportHeight: 268,
    });

    expect(farZoom).toBeLessThan(nearZoom);
  });

  it('clamps invalid or extreme inputs to the supplied bounds', () => {
    expect(
      awarenessZoomLevel({ latitude: 0, radiusMeters: 0, viewportWidth: 390, viewportHeight: 268, minZoom: 3, maxZoom: 18 })
    ).toBe(18);
    expect(
      awarenessZoomLevel({ latitude: 0, radiusMeters: 20_000_000, viewportWidth: 390, viewportHeight: 268, minZoom: 3, maxZoom: 18 })
    ).toBe(3);
  });
});
