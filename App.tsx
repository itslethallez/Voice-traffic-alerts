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

type Screen = 'drive' | 'settings';

export default function App() {
  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_700Bold,
    Archivo_900Black,
  });
  const [screen, setScreen] = useState<Screen>('drive');

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
