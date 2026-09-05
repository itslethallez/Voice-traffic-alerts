const requestForegroundPermissionsAsync = jest.fn();
const requestBackgroundPermissionsAsync = jest.fn();

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', UNDETERMINED: 'undetermined', DENIED: 'denied' },
  requestForegroundPermissionsAsync: () => requestForegroundPermissionsAsync(),
  requestBackgroundPermissionsAsync: () => requestBackgroundPermissionsAsync(),
}));

import {
  BACKGROUND_DENIED_EXPLANATION,
  ensureLocationPermissions,
  FOREGROUND_DENIED_EXPLANATION,
} from '../permissions';

describe('ensureLocationPermissions', () => {
  beforeEach(() => {
    requestForegroundPermissionsAsync.mockReset();
    requestBackgroundPermissionsAsync.mockReset();
  });

  it('never requests background permission if foreground is denied', async () => {
    requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const result = await ensureLocationPermissions();

    expect(result).toEqual({
      foregroundGranted: false,
      backgroundGranted: false,
      explanation: FOREGROUND_DENIED_EXPLANATION,
    });
    expect(requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports foreground-only with an explanation when background is denied', async () => {
    requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const result = await ensureLocationPermissions();

    expect(result).toEqual({
      foregroundGranted: true,
      backgroundGranted: false,
      explanation: BACKGROUND_DENIED_EXPLANATION,
    });
  });

  it('reports full success with no explanation when both are granted', async () => {
    requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });

    const result = await ensureLocationPermissions();

    expect(result).toEqual({
      foregroundGranted: true,
      backgroundGranted: true,
      explanation: null,
    });
  });
});
