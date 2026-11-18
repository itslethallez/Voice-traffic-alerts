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
});
