/**
 * app.config.js instead of app.json so the Mapbox SDK download token (a
 * build-time-only secret, needed to fetch the native Mapbox Maps SDK
 * during a prebuild/dev-client build) can come from the environment
 * instead of being committed. It's read from process.env directly (no
 * EXPO_PUBLIC_ prefix) so it's never inlined into the JS bundle - Expo
 * CLI loads .env into process.env before evaluating this file for every
 * relevant command (start, export, prebuild).
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
      [
        '@rnmapbox/maps',
        {
          RNMapboxMapsDownloadToken: process.env.MAPBOX_DOWNLOAD_TOKEN,
        },
      ],
    ],
  },
};
