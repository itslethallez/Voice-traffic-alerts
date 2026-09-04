import fs from 'node:fs';
import path from 'node:path';

const moduleRoot = path.join(
  process.cwd(),
  'modules',
  'facebook-notification-listener',
);

function readModuleFile(relativePath: string): string {
  return fs.readFileSync(path.join(moduleRoot, relativePath), 'utf8');
}

describe('local Facebook notification listener Expo module', () => {
  it('is Android-only and discoverable by Expo autolinking', () => {
    const packageJson = JSON.parse(readModuleFile('package.json'));
    const expoModuleConfig = JSON.parse(
      readModuleFile('expo-module.config.json'),
    );
    const gradle = readModuleFile('android/build.gradle');

    expect(packageJson.name).toBe('@shotgun/facebook-notification-listener');
    expect(expoModuleConfig).toEqual({
      platforms: ['android'],
      android: {
        modules: [
          'expo.modules.facebooknotificationlistener.FacebookNotificationListenerModule',
        ],
      },
    });
    expect(gradle).toContain("id 'expo-module-gradle-plugin'");
  });

  it('exposes notification access status, permission, settings, and events', () => {
    const moduleSource = readModuleFile(
      'android/src/main/java/expo/modules/facebooknotificationlistener/FacebookNotificationListenerModule.kt',
    );

    expect(moduleSource).toContain('Name("FacebookNotificationListener")');
    expect(moduleSource).toContain('Events(FACEBOOK_NOTIFICATION_EVENT)');
    expect(moduleSource).toContain(
      'AsyncFunction<Boolean>("isNotificationAccessGrantedAsync")',
    );
    expect(moduleSource).toContain(
      'AsyncFunction<String>("getNotificationAccessStatusAsync")',
    );
    expect(moduleSource).toContain(
      'AsyncFunction<Boolean>("openNotificationAccessSettingsAsync")',
    );
    expect(moduleSource).toContain(
      'Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS',
    );
    expect(moduleSource).toContain('catch (_: SecurityException)');
  });

  it('filters to the Facebook package before reading or emitting content', () => {
    const serviceSource = readModuleFile(
      'android/src/main/java/expo/modules/facebooknotificationlistener/FacebookNotificationListenerService.kt',
    );
    const packageGuard =
      'if (sbn.packageName != FACEBOOK_PACKAGE_NAME) return';
    const extrasRead = 'val extras = sbn.notification.extras';
    const publish = 'FacebookNotificationEventRelay.publish(event)';

    expect(serviceSource).toContain(
      'class FacebookNotificationListenerService : NotificationListenerService()',
    );
    expect(serviceSource).toContain(
      'internal const val FACEBOOK_PACKAGE_NAME = "com.facebook.katana"',
    );
    expect(serviceSource.indexOf(packageGuard)).toBeGreaterThan(-1);
    expect(serviceSource.indexOf(extrasRead)).toBeGreaterThan(
      serviceSource.indexOf(packageGuard),
    );
    expect(serviceSource.indexOf(publish)).toBeGreaterThan(
      serviceSource.indexOf(extrasRead),
    );
    expect(serviceSource).not.toMatch(/\b(?:Log\.|println\()/);
  });
});
