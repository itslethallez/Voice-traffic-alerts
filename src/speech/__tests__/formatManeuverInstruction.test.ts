import type { MapboxManeuver } from '../../api/mapbox/types';
import { formatManeuverInstruction } from '../formatManeuverInstruction';

const TURN_LEFT: MapboxManeuver = {
  instruction: 'Turn left onto Main St',
  type: 'turn',
  modifier: 'left',
  location: [138.6, -34.9],
};

describe('formatManeuverInstruction', () => {
  it('states the distance and lowercases the instruction near a 500m checkpoint crossing', () => {
    expect(formatManeuverInstruction(TURN_LEFT, 500)).toBe('In 500 metres, turn left onto Main St.');
  });

  it('states the distance near a 200m checkpoint crossing', () => {
    expect(formatManeuverInstruction(TURN_LEFT, 200)).toBe('In 200 metres, turn left onto Main St.');
  });

  it('uses "now" instead of a distance at 50m or closer', () => {
    expect(formatManeuverInstruction(TURN_LEFT, 50)).toBe('Turn left onto Main St, now.');
    expect(formatManeuverInstruction(TURN_LEFT, 12)).toBe('Turn left onto Main St, now.');
  });

  it('speaks the real live distance, not a fixed checkpoint number', () => {
    // A checkpoint crossing rarely lands on an exact multiple of 500/200 -
    // the whole point is that this reflects what actually fired, rounded
    // for speech, not a hardcoded label.
    expect(formatManeuverInstruction(TURN_LEFT, 463)).toBe('In 450 metres, turn left onto Main St.');
    expect(formatManeuverInstruction(TURN_LEFT, 87)).toBe('In 90 metres, turn left onto Main St.');
  });

  it('rounds to the nearest 0.1km at or above 1000m', () => {
    expect(formatManeuverInstruction(TURN_LEFT, 1520)).toBe('In 1.5 kilometres, turn left onto Main St.');
    expect(formatManeuverInstruction(TURN_LEFT, 1000)).toBe('In 1 kilometre, turn left onto Main St.');
  });
});
