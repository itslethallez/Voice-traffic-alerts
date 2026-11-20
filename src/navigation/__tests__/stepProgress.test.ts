import type { MapboxRouteStep } from '../../api/mapbox/types';
import { computeStepProgress, STEP_ARRIVAL_THRESHOLD_M } from '../stepProgress';

const LON = 138.6;
/** Three points roughly 1000m apart along a meridian (~0.00898 deg lat per km). */
const START = { latitude: -34.93, longitude: LON };
const MID = { latitude: -34.92102, longitude: LON };
const END = { latitude: -34.91204, longitude: LON };

function makeStep(location: { latitude: number; longitude: number }, distance: number): MapboxRouteStep {
  return {
    maneuver: { instruction: 'Continue', type: 'turn', location: [location.longitude, location.latitude] },
    distance,
    duration: distance / 15, // arbitrary, unused by computeStepProgress
    name: 'Test Rd',
    geometry: { type: 'LineString', coordinates: [] },
  };
}

const STEPS: MapboxRouteStep[] = [makeStep(START, 1000), makeStep(MID, 1000), makeStep(END, 0)];

describe('computeStepProgress', () => {
  it('stays on step 0 while far from the next maneuver', () => {
    const progress = computeStepProgress(START, STEPS, 0);
    expect(progress.currentStepIndex).toBe(0);
    expect(progress.hasArrived).toBe(false);
    expect(progress.distanceToNextManeuverM).toBeGreaterThan(900);
  });

  it('advances to the next step once within the arrival threshold of its maneuver', () => {
    const justBeforeMid = { latitude: MID.latitude + 0.0001, longitude: LON }; // a few metres short
    const progress = computeStepProgress(justBeforeMid, STEPS, 0);
    // Distance from justBeforeMid to MID should be well within threshold.
    expect(progress.currentStepIndex).toBe(1);
  });

  it('never regresses to an earlier step even if the driver is geometrically closer to it', () => {
    // Positioned back near START, but previousStepIndex already says step 1.
    const progress = computeStepProgress(START, STEPS, 1);
    expect(progress.currentStepIndex).toBe(1);
  });

  it('reports hasArrived once within the threshold of the final step', () => {
    const atEnd = { latitude: END.latitude, longitude: END.longitude };
    const progress = computeStepProgress(atEnd, STEPS, 1);
    expect(progress.hasArrived).toBe(true);
    expect(progress.currentStepIndex).toBe(STEPS.length - 1);
    expect(progress.remainingDistanceM).toBe(0);
    expect(progress.distanceToNextManeuverM).toBeLessThan(STEP_ARRIVAL_THRESHOLD_M);
  });

  it('sums later steps into remainingDistanceM', () => {
    const progress = computeStepProgress(START, STEPS, 0);
    // distanceToNextManeuverM (~1000) + step[1]'s own distance (1000, the
    // one later full step before arrival).
    expect(progress.remainingDistanceM).toBeGreaterThan(1900);
    expect(progress.remainingDistanceM).toBeLessThan(2100);
  });

  it('treats an empty step list as already arrived', () => {
    const progress = computeStepProgress(START, [], 0);
    expect(progress.hasArrived).toBe(true);
    expect(progress.remainingDistanceM).toBe(0);
  });

  it('advances past a maneuver the fixes skipped over without ever landing near it', () => {
    // 3s fixes at speed: the last fix was on step 0, this one is 300m into step 1.
    const intoStepOne = { latitude: MID.latitude + 300 / 111_320, longitude: LON };
    const progress = computeStepProgress(intoStepOne, STEPS, 0);
    expect(progress.currentStepIndex).toBe(1);
    expect(progress.distanceToNextManeuverM).toBeGreaterThan(650);
    expect(progress.distanceToNextManeuverM).toBeLessThan(750);
  });

  it('measures distance to the next maneuver along the step, not from its start', () => {
    const quarterWay = { latitude: START.latitude + 250 / 111_320, longitude: LON };
    const progress = computeStepProgress(quarterWay, STEPS, 0);
    expect(progress.currentStepIndex).toBe(0);
    expect(progress.distanceToNextManeuverM).toBeGreaterThan(700);
    expect(progress.distanceToNextManeuverM).toBeLessThan(800);
    expect(progress.remainingDistanceM).toBeCloseTo(progress.distanceToNextManeuverM + 1000, 5);
  });

  it('arrives when a fix overshoots the destination without landing within the threshold', () => {
    const pastEnd = { latitude: END.latitude + 40 / 111_320, longitude: LON };
    expect(computeStepProgress(pastEnd, STEPS, 1).hasArrived).toBe(true);
  });

  it('does not arrive when the nearest route point is the destination but the driver is well off the road', () => {
    const offToTheSide = { latitude: END.latitude, longitude: LON + 200 / (111_320 * Math.cos((END.latitude * Math.PI) / 180)) };
    expect(computeStepProgress(offToTheSide, STEPS, 1).hasArrived).toBe(false);
  });

  describe('parallel legs either side of a U-turn', () => {
    const metersEast = (point: { latitude: number; longitude: number }, m: number) => ({
      latitude: point.latitude,
      longitude: point.longitude + m / (111_320 * Math.cos((point.latitude * Math.PI) / 180)),
    });
    const withPath = (step: MapboxRouteStep, path: { latitude: number; longitude: number }[]): MapboxRouteStep => ({
      ...step,
      geometry: { type: 'LineString', coordinates: path.map((p) => [p.longitude, p.latitude]) },
    });
    const midEast = metersEast(MID, 20);
    const startEast = metersEast(START, 20);
    // North on one carriageway, U-turn, back south on the parallel one 20m east.
    const uTurnSteps = [
      withPath(makeStep(START, 1000), [START, MID]),
      withPath(makeStep(MID, 20), [MID, midEast]),
      withPath(makeStep(midEast, 1000), [midEast, startEast]),
      makeStep(startEast, 0),
    ];
    const halfway = { latitude: (START.latitude + MID.latitude) / 2, longitude: LON };
    // 15m east: closer to the southbound leg (5m) than the northbound one (15m).
    const betweenLegs = metersEast(halfway, 15);

    it('stays on the outbound leg when GPS drifts toward the return leg', () => {
      expect(computeStepProgress(betweenLegs, uTurnSteps, 0, 0).currentStepIndex).toBe(0);
    });

    it('stays on the current leg when driving against it while right on it', () => {
      const progress = computeStepProgress(halfway, uTurnSteps, 0, 180);
      expect(progress.currentStepIndex).toBe(0);
    });

    it('stays on the earlier leg when heading is unknown', () => {
      expect(computeStepProgress(betweenLegs, uTurnSteps, 0, null).currentStepIndex).toBe(0);
    });

    it('moves to the return leg once heading shows the U-turn happened outside the maneuver radius', () => {
      const progress = computeStepProgress(betweenLegs, uTurnSteps, 0, 180);
      expect(progress.currentStepIndex).toBe(2);
      expect(progress.remainingDistanceM).toBeLessThan(600);
    });
  });
});
