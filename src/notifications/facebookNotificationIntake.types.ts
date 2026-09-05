export type NotificationAccessStatus = 'granted' | 'denied' | 'unsupported';

export type FacebookNotificationEvent = {
  packageName: 'com.facebook.katana';
  notificationKey: string;
  postedAt: number;
  title: string | null;
  text: string | null;
};

export type NotificationEventSubscription = {
  remove(): void;
};

export type FacebookNotificationIntake = {
  getNotificationAccessStatus(): Promise<NotificationAccessStatus>;
  isNotificationAccessGranted(): Promise<boolean>;
  openNotificationAccessSettings(): Promise<boolean>;
  addListener(
    listener: (event: FacebookNotificationEvent) => void,
  ): NotificationEventSubscription;
};
