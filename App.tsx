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
import { DriveScreen } from './src/screens/DriveScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { useDriveLoop } from './src/screens/useDriveLoop';

type Screen = 'drive' | 'settings';

export default function App() {
  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_700Bold,
    Archivo_900Black,
  });
  const [screen, setScreen] = useState<Screen>('drive');

  // Called here, not inside DriveScreen: App never unmounts while the app
  // is open, but DriveScreen does (swapped out for SettingsScreen). If
  // this lived in DriveScreen, opening Settings mid-drive would unmount
  // and remount the whole location/briefing/announcement lifecycle -
  // wiping dedupe and cache state and re-running the cold-start briefing
  // every time the driver checks a setting.
  useDriveLoop();

  if (!fontsLoaded) {
    return <View style={styles.loading} />;
  }

  return (
    <View style={styles.root}>
      {screen === 'drive' ? (
        <DriveScreen onOpenSettings={() => setScreen('settings')} />
      ) : (
        <SettingsScreen onClose={() => setScreen('drive')} />
      )}
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loading: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
