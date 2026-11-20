import {
  alertDistanceMeters,
  isAlertDistanceSetting,
  maxAlertDistanceMeters,
} from '../alertDistance';

describe('alertDistanceMeters', () => {
  it('uses the per-type defaults decided 20 Nov 2026 at Normal', () => {
    expect(alertDistanceMeters('FIXED_CAMERA', 'normal')).toBe(2_000);
    expect(alertDistanceMeters('MOBILE_CAMERA', 'normal')).toBe(2_000);
    expect(alertDistanceMeters('POLICE', 'normal')).toBe(5_000);
    expect(alertDistanceMeters('ACCIDENT', 'normal')).toBe(5_000);
    expect(alertDistanceMeters('ROAD_CLOSED', 'normal')).toBe(5_000);
    expect(alertDistanceMeters('JAM', 'normal')).toBe(5_000);
    expect(alertDistanceMeters('HAZARD', 'normal')).toBe(2_000);
    expect(alertDistanceMeters('ROADKILL', 'normal')).toBe(2_000);
  });

  it('scales every type together with Close / Far', () => {
    expect(alertDistanceMeters('POLICE', 'close')).toBe(2_500);
    expect(alertDistanceMeters('POLICE', 'far')).toBe(7_500);
    expect(alertDistanceMeters('FIXED_CAMERA', 'close')).toBe(1_000);
    expect(alertDistanceMeters('FIXED_CAMERA', 'far')).toBe(3_000);
  });

  it('gives an unknown feed type the shorter distance', () => {
    expect(alertDistanceMeters('SOMETHING_NEW', 'normal')).toBe(2_000);
  });
});

describe('maxAlertDistanceMeters', () => {
  it('is the largest per-type distance at the setting', () => {
    expect(maxAlertDistanceMeters('normal')).toBe(5_000);
    expect(maxAlertDistanceMeters('far')).toBe(7_500);
  });
});

describe('isAlertDistanceSetting', () => {
  it('accepts only close / normal / far', () => {
    expect(isAlertDistanceSetting('close')).toBe(true);
    expect(isAlertDistanceSetting('far')).toBe(true);
    expect(isAlertDistanceSetting(5000)).toBe(false);
    expect(isAlertDistanceSetting(undefined)).toBe(false);
  });
});
