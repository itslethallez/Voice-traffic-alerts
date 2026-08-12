import {
  ALERT_CATEGORIES,
  clamp,
  defaultSettingsValues,
  enabledTypesFromSettings,
  MAX_ANNOUNCE_DISTANCE_METERS,
  MIN_ANNOUNCE_DISTANCE_METERS,
} from '../settingsDefaults';

describe('defaultSettingsValues', () => {
  it('has all five categories enabled by default', () => {
    for (const category of ALERT_CATEGORIES) {
      expect(defaultSettingsValues.categoriesEnabled[category]).toBe(true);
    }
  });

  it('defaults the announcement distance within the slider range', () => {
    expect(defaultSettingsValues.announceDistanceMeters).toBeGreaterThanOrEqual(
      MIN_ANNOUNCE_DISTANCE_METERS
    );
    expect(defaultSettingsValues.announceDistanceMeters).toBeLessThanOrEqual(
      MAX_ANNOUNCE_DISTANCE_METERS
    );
  });

  it('defaults master mute to off', () => {
    expect(defaultSettingsValues.masterMute).toBe(false);
  });
});

describe('clamp', () => {
  it('leaves an in-range value unchanged', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps below the minimum', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps above the maximum', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('enabledTypesFromSettings', () => {
  it('includes every category when all are enabled', () => {
    const enabled = enabledTypesFromSettings(defaultSettingsValues.categoriesEnabled);
    for (const category of ALERT_CATEGORIES) {
      expect(enabled.has(category)).toBe(true);
    }
  });

  it('excludes a category that has been toggled off', () => {
    const enabled = enabledTypesFromSettings({
      ...defaultSettingsValues.categoriesEnabled,
      POLICE: false,
    });
    expect(enabled.has('POLICE')).toBe(false);
    expect(enabled.has('ACCIDENT')).toBe(true);
  });
});
