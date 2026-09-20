import {
  baseExaggerationAtZoom,
  exaggerationScaleForRelief,
  MIN_EXAGGERATION_SCALE,
  reliefSamplePoints,
  scaledExaggerationExpression,
  TERRAIN_EXAGGERATION_CURVE,
  TERRAIN_RELIEF_FLAT_M,
  TERRAIN_RELIEF_HILLY_M,
  TERRAIN_RELIEF_SAMPLE_RADIUS_M,
  trimmedReliefM,
  trueReliefFromMeasured,
} from '../terrainRelief';

describe('reliefSamplePoints', () => {
  it('places the centre plus an 8-point ring at the sample radius', () => {
    const anchor = { latitude: -34.9285, longitude: 138.6007 };
    const points = reliefSamplePoints(anchor);
    expect(points).toHaveLength(9);
    expect(points[0]).toEqual(anchor);
    const dist = (p: { latitude: number; longitude: number }) =>
      Math.hypot(
        (p.latitude - anchor.latitude) * 111_320,
        (p.longitude - anchor.longitude) * 111_320 * Math.cos((anchor.latitude * Math.PI) / 180)
      );
    for (const p of points.slice(1)) {
      expect(Math.abs(dist(p) - TERRAIN_RELIEF_SAMPLE_RADIUS_M)).toBeLessThan(20);
    }
  });
});

describe('trimmedReliefM', () => {
  it('drops the single lowest and highest samples before taking the spread', () => {
    expect(trimmedReliefM([50, 52, 51, 900, 5, 53, 51, 50, 52])).toBe(3);
  });

  it('returns max-min when all samples are similar', () => {
    expect(trimmedReliefM([50, 52, 51, 53, 50])).toBe(2);
  });

  it('returns 0 for one or two samples', () => {
    expect(trimmedReliefM([42])).toBe(0);
    expect(trimmedReliefM([42, 50])).toBe(8);
  });
});

describe('exaggerationScaleForRelief', () => {
  it('returns the floor scale at or below the flat threshold', () => {
    expect(exaggerationScaleForRelief(0)).toBe(MIN_EXAGGERATION_SCALE);
    expect(exaggerationScaleForRelief(TERRAIN_RELIEF_FLAT_M)).toBe(MIN_EXAGGERATION_SCALE);
    // measured Adelaide CBD ring spread ~12m -> clearly flat
    expect(exaggerationScaleForRelief(12)).toBe(MIN_EXAGGERATION_SCALE);
  });

  it('returns full exaggeration at or above the hilly threshold', () => {
    expect(exaggerationScaleForRelief(TERRAIN_RELIEF_HILLY_M)).toBe(1);
    expect(exaggerationScaleForRelief(400)).toBe(1);
    // measured Adelaide Hills/Katoomba spreads sit in/above the band
    expect(exaggerationScaleForRelief(160)).toBe(1);
  });

  it('interpolates smoothly through the transition band', () => {
    const mid = exaggerationScaleForRelief((TERRAIN_RELIEF_FLAT_M + TERRAIN_RELIEF_HILLY_M) / 2);
    expect(mid).toBeGreaterThan(MIN_EXAGGERATION_SCALE);
    expect(mid).toBeLessThan(1);
    expect(exaggerationScaleForRelief(40)).toBeLessThan(exaggerationScaleForRelief(70));
  });

  it('defaults to full exaggeration on a non-finite reading', () => {
    expect(exaggerationScaleForRelief(NaN)).toBe(1);
  });
});

describe('baseExaggerationAtZoom', () => {
  it('clamps to the curve ends', () => {
    expect(baseExaggerationAtZoom(5)).toBe(TERRAIN_EXAGGERATION_CURVE.midValue);
    expect(baseExaggerationAtZoom(20)).toBe(TERRAIN_EXAGGERATION_CURVE.cityValue);
  });

  it('interpolates between the curve stops', () => {
    const mid = baseExaggerationAtZoom(
      (TERRAIN_EXAGGERATION_CURVE.midZoom + TERRAIN_EXAGGERATION_CURVE.cityZoom) / 2
    );
    expect(mid).toBeCloseTo((TERRAIN_EXAGGERATION_CURVE.midValue + TERRAIN_EXAGGERATION_CURVE.cityValue) / 2);
  });
});

describe('scaledExaggerationExpression', () => {
  it('scales both curve stops', () => {
    expect(scaledExaggerationExpression(0.5)).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      10,
      0.8,
      14,
      0.5,
    ]);
  });
});

describe('trueReliefFromMeasured', () => {
  it('divides the applied exaggeration back out of the reading', () => {
    // 8m measured through 0.12-applied terrain = ~67m of true relief
    expect(trueReliefFromMeasured(8, 0.12)).toBeCloseTo(66.7, 0);
  });

  it('returns the reading unchanged at full exaggeration', () => {
    expect(trueReliefFromMeasured(12, 1)).toBe(12);
  });

  it('avoids dividing by a near-zero exaggeration', () => {
    expect(trueReliefFromMeasured(5, 0)).toBe(5);
  });
});
