import {
  ALERT_CATEGORIES,
  ALERT_FILTER_CATEGORIES,
  clamp,
  defaultSettingsValues,
  enabledTypesFromFilters,
  enabledTypesFromSettings,
  MAX_ANNOUNCE_DISTANCE_METERS,
  MAX_BRIEFING_RADIUS_METERS,
  MIN_ANNOUNCE_DISTANCE_METERS,
  MIN_BRIEFING_RADIUS_METERS,
  wazeTypeToAlertFilter,
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

describe('alertTypeFilters', () => {
  it('has all six filter categories enabled by default', () => {
    for (const category of ALERT_FILTER_CATEGORIES) {
      expect(defaultSettingsValues.alertTypeFilters[category]).toBe(true);
    }
  });
});

describe('wazeTypeToAlertFilter', () => {
  it('maps each known feed type onto its filter-pill category', () => {
    expect(wazeTypeToAlertFilter('POLICE')).toBe('police');
    expect(wazeTypeToAlertFilter('JAM')).toBe('traffic');
    expect(wazeTypeToAlertFilter('ACCIDENT')).toBe('accident');
    expect(wazeTypeToAlertFilter('ROAD_CLOSED')).toBe('closure');
    expect(wazeTypeToAlertFilter('HAZARD')).toBe('hazard');
  });

  it('returns null for unrecognized feed types', () => {
    expect(wazeTypeToAlertFilter('SOMETHING_NEW')).toBeNull();
  });
});

describe('enabledTypesFromFilters', () => {
  it('matches enabledTypesFromSettings when every pill is on', () => {
    const combined = enabledTypesFromFilters(
      defaultSettingsValues.categoriesEnabled,
      defaultSettingsValues.alertTypeFilters
    );
    for (const category of ALERT_CATEGORIES) {
      expect(combined.has(category)).toBe(true);
    }
  });

  it('drops a Waze type when its filter pill is off even if SPEAK THESE has it on', () => {
    const combined = enabledTypesFromFilters(
      defaultSettingsValues.categoriesEnabled,
      { ...defaultSettingsValues.alertTypeFilters, traffic: false }
    );
    expect(combined.has('JAM')).toBe(false);
    expect(combined.has('POLICE')).toBe(true);
  });

  it('stays off when SPEAK THESE is off even if the pill is on', () => {
    const combined = enabledTypesFromFilters(
      { ...defaultSettingsValues.categoriesEnabled, POLICE: false },
      defaultSettingsValues.alertTypeFilters
    );
    expect(combined.has('POLICE')).toBe(false);
  });

  it('gates ROADKILL on its pill alone (it has no SPEAK THESE entry)', () => {
    const on = enabledTypesFromFilters(
      defaultSettingsValues.categoriesEnabled,
      defaultSettingsValues.alertTypeFilters
    );
    expect(on.has('ROADKILL')).toBe(true);
    const off = enabledTypesFromFilters(
      defaultSettingsValues.categoriesEnabled,
      { ...defaultSettingsValues.alertTypeFilters, roadkill: false }
    );
    expect(off.has('ROADKILL')).toBe(false);
  });
});
