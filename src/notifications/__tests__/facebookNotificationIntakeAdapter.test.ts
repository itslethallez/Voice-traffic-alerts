import { facebookNotificationIntake } from '../facebookNotificationIntake';
import {
  createAndroidFacebookNotificationIntake,
  unsupportedFacebookNotificationIntake,
} from '../facebookNotificationIntakeAdapter';

describe('platform-neutral Facebook notification intake', () => {
  it('uses the unsupported adapter so iOS and web remain no-op builds', () => {
    expect(facebookNotificationIntake).toBe(
      unsupportedFacebookNotificationIntake,
    );
  });
});

describe('unsupportedFacebookNotificationIntake', () => {
  it('is a typed no-op on platforms without Android notification access', async () => {
    const listener = jest.fn();
    const subscription = unsupportedFacebookNotificationIntake.addListener(listener);

    await expect(
      unsupportedFacebookNotificationIntake.getNotificationAccessStatus(),
    ).resolves.toBe('unsupported');
    await expect(
      unsupportedFacebookNotificationIntake.isNotificationAccessGranted(),
    ).resolves.toBe(false);
    await expect(
      unsupportedFacebookNotificationIntake.openNotificationAccessSettings(),
    ).resolves.toBe(false);

    subscription.remove();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createAndroidFacebookNotificationIntake', () => {
  it('forwards permission, status, settings, and event APIs to the native module', async () => {
    const remove = jest.fn();
    const nativeModule = {
      getNotificationAccessStatusAsync: jest.fn().mockResolvedValue('granted' as const),
      isNotificationAccessGrantedAsync: jest.fn().mockResolvedValue(true),
      openNotificationAccessSettingsAsync: jest.fn().mockResolvedValue(true),
      addListener: jest.fn().mockReturnValue({ remove }),
    };
    const adapter = createAndroidFacebookNotificationIntake(nativeModule);
    const listener = jest.fn();

    await expect(adapter.getNotificationAccessStatus()).resolves.toBe('granted');
    await expect(adapter.isNotificationAccessGranted()).resolves.toBe(true);
    await expect(adapter.openNotificationAccessSettings()).resolves.toBe(true);
    const subscription = adapter.addListener(listener);
    subscription.remove();

    expect(nativeModule.getNotificationAccessStatusAsync).toHaveBeenCalledTimes(1);
    expect(nativeModule.isNotificationAccessGrantedAsync).toHaveBeenCalledTimes(1);
    expect(nativeModule.openNotificationAccessSettingsAsync).toHaveBeenCalledTimes(1);
    expect(nativeModule.addListener).toHaveBeenCalledWith(
      'onFacebookNotification',
      listener,
    );
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('falls back safely when the native module is unavailable', async () => {
    const adapter = createAndroidFacebookNotificationIntake(null);

    await expect(adapter.getNotificationAccessStatus()).resolves.toBe('unsupported');
    await expect(adapter.isNotificationAccessGranted()).resolves.toBe(false);
  });
});
