import type {
  FacebookNotificationEvent,
  FacebookNotificationIntake,
  NotificationAccessStatus,
  NotificationEventSubscription,
} from './facebookNotificationIntake.types';

export type NativeFacebookNotificationListenerModule = {
  getNotificationAccessStatusAsync(): Promise<NotificationAccessStatus>;
  isNotificationAccessGrantedAsync(): Promise<boolean>;
  openNotificationAccessSettingsAsync(): Promise<boolean>;
  addListener(
    eventName: 'onFacebookNotification',
    listener: (event: FacebookNotificationEvent) => void,
  ): NotificationEventSubscription;
};

export const unsupportedFacebookNotificationIntake: FacebookNotificationIntake = {
  async getNotificationAccessStatus() {
    return 'unsupported';
  },

  async isNotificationAccessGranted() {
    return false;
  },

  async openNotificationAccessSettings() {
    return false;
  },

  addListener() {
    return { remove() {} };
  },
};

export function createAndroidFacebookNotificationIntake(
  nativeModule: NativeFacebookNotificationListenerModule | null,
): FacebookNotificationIntake {
  if (!nativeModule) {
    return unsupportedFacebookNotificationIntake;
  }

  return {
    getNotificationAccessStatus: () =>
      nativeModule.getNotificationAccessStatusAsync(),
    isNotificationAccessGranted: () =>
      nativeModule.isNotificationAccessGrantedAsync(),
    openNotificationAccessSettings: () =>
      nativeModule.openNotificationAccessSettingsAsync(),
    addListener: (listener) =>
      nativeModule.addListener('onFacebookNotification', listener),
  };
}
