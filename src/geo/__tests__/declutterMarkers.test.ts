import { clusterMarkers, markerSeparationMeters } from '../declutterMarkers';

const DRIVER = { latitude: -34.9285, longitude: 138.6007 };

const marker = (id: string, latOffsetM: number, lonOffsetM: number) => ({
  id,
  latitude: DRIVER.latitude + latOffsetM / 111_320,
  longitude: DRIVER.longitude + lonOffsetM / (111_320 * Math.cos((DRIVER.latitude * Math.PI) / 180)),
});

describe('markerSeparationMeters', () => {
  it('shrinks as zoom increases (more map detail, more room)', () => {
    expect(markerSeparationMeters(17, DRIVER.latitude)).toBeLessThan(markerSeparationMeters(14, DRIVER.latitude));
  });
});

describe('clusterMarkers', () => {
  it('keeps far-apart markers in their own clusters', () => {
    const items = [marker('a', 0, 0), marker('b', 0, 500)];
    const clusters = clusterMarkers(items, { separationMeters: 100, driverPosition: DRIVER });
    expect(clusters).toHaveLength(2);
  });

  it('merges overlapping markers into the nearer one', () => {
    const near = marker('near', 0, 0);
    const far = marker('far', 0, 40); // 40m away, inside a 100m separation
    const clusters = clusterMarkers([far, near], { separationMeters: 100, driverPosition: DRIVER });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].primary.id).toBe('near');
    expect(clusters[0].members.map((m) => m.id)).toEqual(['near', 'far']);
  });

  it('two pinned markers never merge, even within the separation radius', () => {
    const clusters = clusterMarkers([marker('pinA', 0, 0), marker('pinB', 0, 40)], {
      separationMeters: 100,
      driverPosition: DRIVER,
      pinnedIds: new Set(['pinA', 'pinB']),
    });
    expect(clusters).toHaveLength(2);
  });

  it('a pinned marker still absorbs nearby unpinned markers into its own cluster', () => {
    // 'pinned' sorts first and becomes a cluster primary; 'plain' is 40m
    // from it (under the 100m separation) so it joins that cluster even
    // though 'plain' sits exactly on the driver.
    const clusters = clusterMarkers([marker('plain', 0, 0), marker('pinned', 0, 40)], {
      separationMeters: 100,
      driverPosition: DRIVER,
      pinnedIds: new Set(['pinned']),
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].primary.id).toBe('pinned');
    expect(clusters[0].members.map((m) => m.id)).toEqual(['pinned', 'plain']);
  });
});
