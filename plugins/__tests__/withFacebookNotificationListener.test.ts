type AndroidManifest = {
  manifest: {
    application: Array<{
      service?: Array<{
        $: Record<string, string>;
        'intent-filter'?: Array<{
          action: Array<{ $: Record<string, string> }>;
        }>;
      }>;
    }>;
  };
};

const {
  ensureFacebookNotificationListenerService,
} = require('../withFacebookNotificationListener');

describe('withFacebookNotificationListener', () => {
  it('declares a protected, non-exported notification listener service', () => {
    const manifest: AndroidManifest = {
      manifest: { application: [{ service: [] }] },
    };

    ensureFacebookNotificationListenerService(manifest);

    expect(manifest.manifest.application[0].service).toContainEqual({
      $: {
        'android:name':
          'expo.modules.facebooknotificationlistener.FacebookNotificationListenerService',
        'android:label': 'Streetwise Facebook notification intake',
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
    });
  });

  it('is idempotent across repeated prebuilds', () => {
    const manifest: AndroidManifest = {
      manifest: { application: [{}] },
    };

    ensureFacebookNotificationListenerService(manifest);
    ensureFacebookNotificationListenerService(manifest);

    expect(manifest.manifest.application[0].service).toHaveLength(1);
  });

  it('is registered in the dynamic Expo config', () => {
    const { expo } = require('../../app.config');

    expect(expo.plugins).toContain(
      './plugins/withFacebookNotificationListener',
    );
  });
});
