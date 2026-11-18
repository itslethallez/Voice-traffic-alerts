import {
  ALERT_CATEGORIES,
  ALERT_FILTER_CATEGORIES,
  clamp,
  defaultSettingsValues,
  enabledTypesFromSettings,
  MAX_ANNOUNCE_DISTANCE_METERS,
  MAX_BRIEFING_RADIUS_METERS,
  MIN_ANNOUNCE_DISTANCE_METERS,
  MIN_BRIEFING_RADIUS_METERS,
  speakableTypesFromFilters,
  visibleTypesFromFilters,
  wazeTypeToAlertFilter,
} from '../settingsDefaults';

describe('defaultSettingsValues', () => {
  it('has six voice categories on and fixed cameras voice-off by default', () => {
    // FIXED_CAMERA is the deliberate exception: permanent infrastructure is
    // map-marker-only unless the driver opts into voice - announcing it on
    // every pass is the noise that gets an app muted.
    for (const category of ALERT_CATEGORIES) {
      expect(defaultSettingsValues.categoriesEnabled[category]).toBe(category !== 'FIXED_CAMERA');
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

  it('defaults the route type to safest', () => {
    expect(defaultSettingsValues.defaultRouteType).toBe('safest');
  });

  it('defaults the briefing radius within the slider range, separate from announce distance', () => {
    expect(defaultSettingsValues.briefingRadiusMeters).toBeGreaterThanOrEqual(
      MIN_BRIEFING_RADIUS_METERS
    );
    expect(defaultSettingsValues.briefingRadiusMeters).toBeLessThanOrEqual(
      MAX_BRIEFING_RADIUS_METERS
    );
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
  it('includes every category whose voice default is on', () => {
    const enabled = enabledTypesFromSettings(defaultSettingsValues.categoriesEnabled);
    for (const category of ALERT_CATEGORIES) {
      expect(enabled.has(category)).toBe(category !== 'FIXED_CAMERA');
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

describe('alertTypeFilters', () => {
  it('has all eight filter categories enabled by default', () => {
    for (const category of ALERT_FILTER_CATEGORIES) {
      expect(defaultSettingsValues.alertTypeFilters[category]).toBe(true);
    }
  });
});

describe('wazeTypeToAlertFilter', () => {
  it('maps each known feed type onto its filter-pill category', () => {
    expect(wazeTypeToAlertFilter('POLICE')).toBe('police');
    expect(wazeTypeToAlertFilter('MOBILE_CAMERA')).toBe('mobile_camera');
    expect(wazeTypeToAlertFilter('FIXED_CAMERA')).toBe('fixed_camera');
    expect(wazeTypeToAlertFilter('JAM')).toBe('traffic');
    expect(wazeTypeToAlertFilter('ACCIDENT')).toBe('accident');
    expect(wazeTypeToAlertFilter('ROAD_CLOSED')).toBe('closure');
    expect(wazeTypeToAlertFilter('HAZARD')).toBe('hazard');
  });

  it('returns null for unrecognized feed types', () => {
    expect(wazeTypeToAlertFilter('SOMETHING_NEW')).toBeNull();
  });
});

describe('visibleTypesFromFilters', () => {
  it('shows every pill-enabled category regardless of the SPEAK THESE toggles', () => {
    const visible = visibleTypesFromFilters(defaultSettingsValues.alertTypeFilters);
    for (const category of ALERT_CATEGORIES) {
      expect(visible.has(category)).toBe(true);
    }
    // ROADKILL has no voice toggle but still displays.
    expect(visible.has('ROADKILL')).toBe(true);
  });

  it('keeps a category visible when its voice is muted (decoupled gates)', () => {
    // Voice-off is a speakableTypes concern - muting FIXED_CAMERA in
    // Settings must not blind its map markers.
    const visible = visibleTypesFromFilters(defaultSettingsValues.alertTypeFilters);
    expect(visible.has('FIXED_CAMERA')).toBe(true);
  });

  it('hides a category whose pill is off', () => {
    const visible = visibleTypesFromFilters({
      ...defaultSettingsValues.alertTypeFilters,
      fixed_camera: false,
    });
    expect(visible.has('FIXED_CAMERA')).toBe(false);
    expect(visible.has('MOBILE_CAMERA')).toBe(true);
  });
});

describe('speakableTypesFromFilters', () => {
  it('matches enabledTypesFromSettings when every pill is on', () => {
    const combined = speakableTypesFromFilters(
      defaultSettingsValues.categoriesEnabled,
      defaultSettingsValues.alertTypeFilters
    );
    for (const category of ALERT_CATEGORIES) {
      expect(combined.has(category)).toBe(category !== 'FIXED_CAMERA');
    }
  });

  it('drops a Waze type when its filter pill is off even if SPEAK THESE has it on', () => {
    const combined = speakableTypesFromFilters(
      defaultSettingsValues.categoriesEnabled,
      { ...defaultSettingsValues.alertTypeFilters, traffic: false }
    );
    expect(combined.has('JAM')).toBe(false);
    expect(combined.has('POLICE')).toBe(true);
  });

  it('stays off when SPEAK THESE is off even if the pill is on', () => {
    const combined = speakableTypesFromFilters(
      { ...defaultSettingsValues.categoriesEnabled, POLICE: false },
      defaultSettingsValues.alertTypeFilters
    );
    expect(combined.has('POLICE')).toBe(false);
  });

  it('gates each camera type on its own voice toggle independently', () => {
    const combined = speakableTypesFromFilters(
      { ...defaultSettingsValues.categoriesEnabled, FIXED_CAMERA: false },
      defaultSettingsValues.alertTypeFilters
    );
    expect(combined.has('FIXED_CAMERA')).toBe(false);
    expect(combined.has('MOBILE_CAMERA')).toBe(true);
    expect(combined.has('POLICE')).toBe(true);
  });

  it('gates ROADKILL on its pill alone (it has no SPEAK THESE entry)', () => {
    const on = speakableTypesFromFilters(
      defaultSettingsValues.categoriesEnabled,
      defaultSettingsValues.alertTypeFilters
    );
    expect(on.has('ROADKILL')).toBe(true);
    const off = speakableTypesFromFilters(
      defaultSettingsValues.categoriesEnabled,
      { ...defaultSettingsValues.alertTypeFilters, roadkill: false }
    );
    expect(off.has('ROADKILL')).toBe(false);
  });
});
