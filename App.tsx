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
import { colors } from './src/theme/colors';
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

  // Called here, not inside DriveScreen: App never unmounts while the app
  // is open, but DriveScreen does (swapped out when another tab is
  // active). If this lived in DriveScreen, switching tabs mid-drive would
  // unmount and remount the whole location/briefing/announcement
  // lifecycle - wiping dedupe and cache state and re-running the
  // cold-start briefing every time the driver checks History or Settings.
  useDriveLoop();

  if (!fontsLoaded) {
    return <View style={styles.loading} />;
  }

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        {tab === 'radio' ? <DriveScreen /> : null}
        {tab === 'history' ? <HistoryScreen /> : null}
        {tab === 'settings' ? <SettingsScreen onClose={() => setTab('radio')} /> : null}
      </View>
      <BottomNav active={tab} onChange={setTab} />
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  loading: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
