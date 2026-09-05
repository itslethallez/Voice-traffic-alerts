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
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { WazeAlert } from './src/api/waze/types';
import { BottomNav, type NavTab } from './src/navigation/BottomNav';
import { DriveScreen } from './src/screens/DriveScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { useDriveLoop } from './src/screens/useDriveLoop';
import { hud } from './src/theme/colors';

const REPORT_FOCUS_DURATION_MS = 5000;

export default function App() {
  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_700Bold,
    Archivo_900Black,
  });
  const [tab, setTab] = useState<NavTab>('map');
  const [focusedAlert, setFocusedAlert] = useState<WazeAlert | null>(null);

  // The trip lifecycle stays at the application level, and all screens stay
  // mounted. This preserves the existing Mapbox/location crash workaround
  // while making the primary navigation map → reports → settings.
  useDriveLoop();

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

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <View style={styles.content}>
          <View style={[styles.screen, tab !== 'map' && styles.hiddenScreen]}>
            <DriveScreen focusedAlert={focusedAlert} onFocusAlert={focusAlertOnMap} />
          </View>
          <View style={[styles.screen, tab !== 'reports' && styles.hiddenScreen]}>
            <ReportsScreen
              onSelectAlert={focusAlertOnMap}
            />
          </View>
          <View style={[styles.screen, tab !== 'settings' && styles.hiddenScreen]}>
            <SettingsScreen onClose={() => setTab('map')} />
          </View>
        </View>
        <BottomNav active={tab} onChange={setTab} />
        <StatusBar style={tab === 'reports' ? 'dark' : 'light'} />
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
