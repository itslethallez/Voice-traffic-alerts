import { formatSpeedCameraWarning } from '../formatSpeedCameraWarning';
import type { RoadContext } from '../../engine/types';

const AHEAD: RoadContext = { kind: 'ahead', roadName: 'Portrush Road', alongRoadMeters: 480 };
const AHEAD_UNNAMED: RoadContext = { kind: 'ahead', roadName: null, alongRoadMeters: 480 };

describe('formatSpeedCameraWarning', () => {
  it('names a camera for the camera trigger, never claiming there is a report', () => {
    const text = formatSpeedCameraWarning('camera', 200, true, AHEAD);
    expect(text).toBe(
      "Speed camera, 200 metres ahead on Portrush Road, you're currently over the limit. Reduce speed immediately."
    );
    expect(text).not.toContain('Police reported');
  });

  it('names a police report for the report trigger, never claiming there is a camera', () => {
    const text = formatSpeedCameraWarning('report', 200, true, AHEAD);
    expect(text).toBe(
      "Police reported, 200 metres ahead on Portrush Road, you're currently over the limit. Reduce speed immediately."
    );
    expect(text).not.toContain('Speed camera');
  });

  it('speaks the fixed checkpoint distance that fired, not a raw GPS distance', () => {
    expect(formatSpeedCameraWarning('camera', 500, true, AHEAD)).toContain('500 metres ahead');
    expect(formatSpeedCameraWarning('camera', 200, true, AHEAD)).toContain('200 metres ahead');
  });

  it('both confirmed variants end with the same call to action', () => {
    expect(formatSpeedCameraWarning('camera', 200, true, AHEAD)).toContain('Reduce speed immediately.');
    expect(formatSpeedCameraWarning('report', 200, true, AHEAD)).toContain('Reduce speed immediately.');
  });

  it('drops the "over the limit" claim entirely when the speed limit was never confirmed', () => {
    const text = formatSpeedCameraWarning('camera', 200, false, AHEAD);
    expect(text).toBe('Speed camera, 200 metres ahead on Portrush Road.');
    expect(text).not.toContain('over the limit');
    expect(text).not.toContain('Reduce speed immediately.');
  });

  it('still names a police report correctly when unconfirmed', () => {
    expect(formatSpeedCameraWarning('report', 500, false, AHEAD)).toBe('Police reported, 500 metres ahead on Portrush Road.');
  });

  it('leaves the road name out when Mapbox has none', () => {
    expect(formatSpeedCameraWarning('camera', 500, false, AHEAD_UNNAMED)).toBe('Speed camera, 500 metres ahead.');
  });

  it('says "nearby" and makes no speeding claim when the camera is not confirmed on the driver\'s road (case F)', () => {
    // The speed limit was looked up for the driver's road, not the camera's.
    for (const road of [null, { kind: 'nearby' } as RoadContext]) {
      const text = formatSpeedCameraWarning('camera', 500, true, road);
      expect(text).toBe('Speed camera nearby, 500 metres away.');
      expect(text).not.toContain('ahead');
      expect(text).not.toContain('over the limit');
    }
  });
});
