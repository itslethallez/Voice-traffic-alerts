import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { useFonts } from 'expo-font';
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_700Bold,
  Archivo_900Black,
} from '@expo-google-fonts/archivo';
import { hud } from './src/theme/colors';
import { BottomNav, type NavTab } from './src/navigation/BottomNav';
import { DriveScreen } from './src/screens/DriveScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { useDriveLoop } from './src/screens/useDriveLoop';

export default function App() {
  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_700Bold,
    Archivo_900Black,
  });
  const [tab, setTab] = useState<NavTab>('radio');

  // Called here, not inside DriveScreen, so the location/briefing/
  // announcement lifecycle is tied to App's own lifetime rather than
  // DriveScreen's - belt-and-suspenders alongside the screens below now
  // staying permanently mounted (display-toggled, not unmounted) on tab
  // switches: even if that ever changes, this still wouldn't wipe dedupe
  // state or re-run the cold-start briefing every time the driver checks
  // History or Settings.
  useDriveLoop();

  if (!fontsLoaded) {
    return <View style={styles.loading} />;
  }

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        {/* All three screens stay mounted permanently - switching tabs
         * toggles `display` instead of conditionally rendering the JSX.
         * Confirmed via a TestFlight crash log: tapping History or
         * Settings unmounted DriveScreen's whole view tree (RadarMap's
         * native Mapbox MapView included) in a Fabric mounting
         * transaction on the main thread, at the same moment
         * expo-location's background task consumer did a blocking
         * synchronous dispatch onto that same main thread
         * (EXLocationTaskConsumer.reset()) - the collision threw an
         * uncaught native exception and aborted the process. That's not a
         * catchable JS error, so no try/catch here would have helped.
         * `display: none` removes a screen from layout and paints nothing
         * for it without unmounting its React tree or native views, which
         * removes the view-teardown burst from the tab-switch path
         * entirely - there's nothing left for the location-task reset to
         * collide with. */}
        <View style={[styles.screen, tab !== 'radio' && styles.hiddenScreen]}>
          <DriveScreen />
        </View>
        <View style={[styles.screen, tab !== 'history' && styles.hiddenScreen]}>
          <HistoryScreen />
        </View>
        <View style={[styles.screen, tab !== 'settings' && styles.hiddenScreen]}>
          <SettingsScreen onClose={() => setTab('radio')} />
        </View>
      </View>
      <BottomNav active={tab} onChange={setTab} />
      <StatusBar style="light" />
    </View>
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
