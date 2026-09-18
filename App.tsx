import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { useFonts } from 'expo-font';
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_700Bold,
  Archivo_900Black,
} from '@expo-google-fonts/archivo';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { Rajdhani_600SemiBold, Rajdhani_700Bold } from '@expo-google-fonts/rajdhani';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { WazeAlert } from './src/api/waze/types';
import { DriveScreen } from './src/screens/DriveScreen';
import { NavigationSearchScreen } from './src/screens/NavigationSearchScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { useDriveLoop } from './src/screens/useDriveLoop';
import { useFacebookNotificationSource } from './src/notifications/useFacebookNotificationSource';
import { DesignSystemPreviewScreen } from './src/screens/DesignSystemPreviewScreen';
import { hud } from './src/theme/colors';

const REPORT_FOCUS_DURATION_MS = 5000;

/** Debug toggle: set true to mount the design-system preview instead of the
 * app — the base components in src/components/base render against it. */
const SHOW_DESIGN_SYSTEM_PREVIEW = false;

export default function App() {
  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_700Bold,
    Archivo_900Black,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Rajdhani_600SemiBold,
    Rajdhani_700Bold,
  });
  // Map-first chrome: no bottom tab bar - the map owns the screen and
  // settings is reached through the map header's gear, matching the §8
  // hierarchy (secondary surfaces stay hidden until requested).
  const [tab, setTab] = useState<'map' | 'settings'>('map');
  const [focusedAlert, setFocusedAlert] = useState<WazeAlert | null>(null);
  const [showNavigationSearch, setShowNavigationSearch] = useState(false);

  // The trip lifecycle stays at the application level, and all screens stay
  // mounted. This preserves the existing Mapbox/location crash workaround
  // while making the primary navigation map → settings.
  useDriveLoop();
  const notificationSource = useFacebookNotificationSource();

  useEffect(() => {
    if (!focusedAlert) return;
    const timer = setTimeout(() => setFocusedAlert(null), REPORT_FOCUS_DURATION_MS);
    return () => clearTimeout(timer);
  }, [focusedAlert]);

  const focusAlertOnMap = (alert: WazeAlert) => {
    setFocusedAlert(alert);
    setTab('map');
  };

  if (!fontsLoaded) {
    return <View style={styles.loading} />;
  }

  if (SHOW_DESIGN_SYSTEM_PREVIEW) {
    return (
      <SafeAreaProvider>
        <DesignSystemPreviewScreen />
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <View style={styles.content}>
          <View style={[styles.screen, tab !== 'map' && styles.hiddenScreen]}>
            <DriveScreen
              focusedAlert={focusedAlert}
              onFocusAlert={focusAlertOnMap}
              onOpenSearch={() => setShowNavigationSearch(true)}
              onOpenSettings={() => setTab('settings')}
            />
          </View>
          <View style={[styles.screen, tab !== 'settings' && styles.hiddenScreen]}>
            <SettingsScreen
              onClose={() => setTab('map')}
              notificationSource={notificationSource}
            />
          </View>
        </View>
        <StatusBar style="light" />
        {showNavigationSearch ? (
          <View style={styles.screen}>
            <NavigationSearchScreen
              onClose={() => setShowNavigationSearch(false)}
              onNavigationStarted={() => setShowNavigationSearch(false)}
            />
          </View>
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: hud.ground,
  },
  content: {
    flex: 1,
  },
  screen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  hiddenScreen: {
    display: 'none',
  },
  loading: {
    flex: 1,
    backgroundColor: hud.ground,
  },
});