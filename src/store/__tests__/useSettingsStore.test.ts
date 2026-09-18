import { defaultSettingsValues } from '../settingsDefaults';
import { mergePersistedSettings } from '../useSettingsStore';

describe('mergePersistedSettings', () => {
  it('fills in category keys an older install never persisted', () => {
    // Simulates a settings blob saved before mobile_camera/fixed_camera
    // existed: only the old keys are present, the new ones must come
    // back with their defaults rather than read as falsy (off).
    const persisted = {
      alertTypeFilters: {
        police: false,
        traffic: true,
        accident: true,
        closure: true,
        roadkill: true,
        hazard: true,
      },
      categoriesEnabled: {
        POLICE: true,
        ACCIDENT: false,
        HAZARD: true,
        ROAD_CLOSED: true,
        JAM: true,
      },
    };

    const merged = mergePersistedSettings(
      persisted as Parameters<typeof mergePersistedSettings>[0],
      defaultSettingsValues
    );

    // Saved values still win.
    expect(merged.alertTypeFilters.police).toBe(false);
    expect(merged.categoriesEnabled.ACCIDENT).toBe(false);
    // New keys pick up defaults instead of reading as off - including
    // FIXED_CAMERA's deliberate voice-off default (map-marker-only).
    expect(merged.alertTypeFilters.mobile_camera).toBe(true);
    expect(merged.alertTypeFilters.fixed_camera).toBe(true);
    expect(merged.categoriesEnabled.MOBILE_CAMERA).toBe(true);
    expect(merged.categoriesEnabled.FIXED_CAMERA).toBe(false);
  });

  it('returns defaults untouched when nothing was persisted', () => {
    const merged = mergePersistedSettings(undefined, defaultSettingsValues);
    expect(merged.categoriesEnabled).toEqual(defaultSettingsValues.categoriesEnabled);
    expect(merged.alertTypeFilters).toEqual(defaultSettingsValues.alertTypeFilters);
  });
});
