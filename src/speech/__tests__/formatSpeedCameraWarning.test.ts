import { formatSpeedCameraWarning } from '../formatSpeedCameraWarning';

describe('formatSpeedCameraWarning', () => {
  it('names a camera for the camera trigger, never claiming there is a report', () => {
    const text = formatSpeedCameraWarning('camera', 200, true);
    expect(text).toBe("Speed camera 200 metres ahead, you're currently over the limit. Reduce speed immediately.");
    expect(text).not.toContain('Police reported');
  });

  it('names a police report for the report trigger, never claiming there is a camera', () => {
    const text = formatSpeedCameraWarning('report', 200, true);
    expect(text).toBe("Police reported 200 metres ahead, you're currently over the limit. Reduce speed immediately.");
    expect(text).not.toContain('Speed camera');
  });

  it('speaks the fixed checkpoint distance that fired, not a raw GPS distance', () => {
    expect(formatSpeedCameraWarning('camera', 500, true)).toContain('500 metres ahead');
    expect(formatSpeedCameraWarning('camera', 200, true)).toContain('200 metres ahead');
  });

  it('both confirmed variants end with the same call to action', () => {
    expect(formatSpeedCameraWarning('camera', 200, true)).toContain('Reduce speed immediately.');
    expect(formatSpeedCameraWarning('report', 200, true)).toContain('Reduce speed immediately.');
  });

  it('drops the "over the limit" claim entirely when the speed limit was never confirmed', () => {
    const text = formatSpeedCameraWarning('camera', 200, false);
    expect(text).toBe('Speed camera 200 metres ahead.');
    expect(text).not.toContain('over the limit');
    expect(text).not.toContain('Reduce speed immediately.');
  });

  it('still names a police report correctly when unconfirmed', () => {
    const text = formatSpeedCameraWarning('report', 500, false);
    expect(text).toBe('Police reported 500 metres ahead.');
  });
});
