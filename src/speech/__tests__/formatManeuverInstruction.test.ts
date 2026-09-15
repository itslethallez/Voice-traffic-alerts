import type { MapboxManeuver } from '../../api/mapbox/types';
import { formatManeuverInstruction } from '../formatManeuverInstruction';

const TURN_LEFT: MapboxManeuver = {
  instruction: 'Turn left onto Main St',
  type: 'turn',
  modifier: 'left',
  location: [138.6, -34.9],
};

describe('formatManeuverInstruction', () => {
  it('states the distance and lowercases the instruction for a 500m checkpoint', () => {
    expect(formatManeuverInstruction(TURN_LEFT, 500)).toBe('In 500 metres, turn left onto Main St.');
  });

  it('states the distance for a 200m checkpoint', () => {
    expect(formatManeuverInstruction(TURN_LEFT, 200)).toBe('In 200 metres, turn left onto Main St.');
  });

  it('uses "now" instead of a distance for the 50m checkpoint', () => {
    expect(formatManeuverInstruction(TURN_LEFT, 50)).toBe('Turn left onto Main St, now.');
  });
});
