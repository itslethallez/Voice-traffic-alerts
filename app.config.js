/**
 * app.config.js instead of app.json for the Mapbox SDK download token -
 * see the RNMAPBOX_MAPS_DOWNLOAD_TOKEN note below. Nothing here reads it
 * directly (Android's Gradle scripts and iOS's Podfile both pull it
 * straight from the environment themselves via ENV[...]/getenv(...)) but
 * app.config.js is still what makes Expo CLI load .env into process.env
 * - and therefore into every child build process it spawns - for every
 * relevant command (start, export, prebuild, run:android/ios).
 */
module.exports = {
  expo: {
    name: 'voice-traffic-alerts',
    slug: 'voice-traffic-alerts',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.itslethallez.voicetrafficalerts',
      // No non-exempt encryption (no custom crypto beyond standard HTTPS)
      // - declaring this here skips the manual App Store Connect prompt
      // on every build.
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.itslethallez.voicetrafficalerts',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    // eas.json's build profiles reference an update channel, which needs
    // expo-updates installed and these two fields - eas-cli tried to
    // write them itself (via `eas update:configure`) and hit the same
    // "can't write to dynamic config" wall as the projectId below.
    updates: {
      url: 'https://u.expo.dev/7f55f15f-fe4a-4c06-936a-34131e8a5025',
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    plugins: [
      // expo-asset is a required peer dependency of expo-audio (expo
      // doctor flags a missing one as a real crash risk outside Expo Go)
      // - no config of its own, just needs to be present as a plugin.
      'expo-asset',
      [
        'expo-audio',
        {
          enableBackgroundPlayback: true,
          microphonePermission:
            'SHOTGUN uses your microphone to record voice reports about what you see.',
        },
      ],
      'expo-font',
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'Voice Traffic Alerts uses your location, including in the background, to warn you about what is ahead on your route.',
          locationAlwaysPermission:
            'Voice Traffic Alerts uses your location, including in the background, to warn you about what is ahead on your route.',
          locationWhenInUsePermission:
            'Voice Traffic Alerts uses your location to warn you about what is ahead on your route.',
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      // No plugin config needed for the download token - both platforms'
      // native build tooling read RNMAPBOX_MAPS_DOWNLOAD_TOKEN straight
      // out of the environment (see the comment above); passing it
      // through the old RNMapboxMapsDownloadToken plugin prop instead is
      // now deprecated by @rnmapbox/maps itself.
      '@rnmapbox/maps',
    ],
    extra: {
      eas: {
        projectId: '7f55f15f-fe4a-4c06-936a-34131e8a5025',
      },
    },
  },
};
