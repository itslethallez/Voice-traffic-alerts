const { withAndroidManifest } = require('@expo/config-plugins');

const SERVICE_NAME =
  'expo.modules.facebooknotificationlistener.FacebookNotificationListenerService';

function ensureFacebookNotificationListenerService(androidManifest) {
  const application = androidManifest.manifest.application?.[0];
  if (!application) {
    throw new Error('AndroidManifest.xml is missing an <application> element');
  }

  application.service = application.service || [];
  const service = {
    $: {
      'android:name': SERVICE_NAME,
      'android:label': 'Shotgun Facebook notification intake',
      'android:permission':
        'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
      'android:exported': 'false',
    },
    'intent-filter': [
      {
        action: [
          {
            $: {
              'android:name':
                'android.service.notification.NotificationListenerService',
            },
          },
        ],
      },
    ],
  };
  const existingIndex = application.service.findIndex(
    (entry) => entry.$?.['android:name'] === SERVICE_NAME,
  );
  if (existingIndex >= 0) {
    application.service[existingIndex] = service;
  } else {
    application.service.push(service);
  }

  return androidManifest;
}

function withFacebookNotificationListener(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    configWithManifest.modResults = ensureFacebookNotificationListenerService(
      configWithManifest.modResults,
    );
    return configWithManifest;
  });
}

module.exports = withFacebookNotificationListener;
module.exports.ensureFacebookNotificationListenerService =
  ensureFacebookNotificationListenerService;
