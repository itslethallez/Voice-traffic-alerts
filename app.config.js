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
    },
    android: {
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
    plugins: [
      [
        'expo-audio',
        {
          enableBackgroundPlayback: true,
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
  },
};
