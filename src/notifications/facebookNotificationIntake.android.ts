import { requireOptionalNativeModule } from 'expo-modules-core';

import {
  createAndroidFacebookNotificationIntake,
  type NativeFacebookNotificationListenerModule,
} from './facebookNotificationIntakeAdapter';

export type {
  FacebookNotificationEvent,
  FacebookNotificationIntake,
  NotificationAccessStatus,
  NotificationEventSubscription,
} from './facebookNotificationIntake.types';

const nativeModule =
  requireOptionalNativeModule<NativeFacebookNotificationListenerModule>(
    'FacebookNotificationListener',
  );

export const facebookNotificationIntake =
  createAndroidFacebookNotificationIntake(nativeModule);
