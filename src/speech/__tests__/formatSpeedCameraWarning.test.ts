import { formatSpeedCameraWarning } from '../formatSpeedCameraWarning';

describe('formatSpeedCameraWarning', () => {
  it('names a camera for the camera trigger, never claiming there is a report', () => {
    const text = formatSpeedCameraWarning('camera');
    expect(text).toBe("Speed camera ahead, you're currently over the limit. Reduce speed immediately.");
    expect(text).not.toContain('Police reported');
  });

  it('names a police report for the report trigger, never claiming there is a camera', () => {
    const text = formatSpeedCameraWarning('report');
    expect(text).toBe("Police reported ahead, you're currently over the limit. Reduce speed immediately.");
    expect(text).not.toContain('Speed camera');
  });

  it('both variants end with the same call to action', () => {
    expect(formatSpeedCameraWarning('camera')).toContain('Reduce speed immediately.');
    expect(formatSpeedCameraWarning('report')).toContain('Reduce speed immediately.');
  });
});
