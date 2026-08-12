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

export default function App() {
  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_700Bold,
    Archivo_900Black,
  });

  if (!fontsLoaded) {
    return <View style={styles.loading} />;
  }

  return (
    <View style={styles.root}>
      {/* Step 7 wires real navigation to a Settings screen. */}
      <DriveScreen onOpenSettings={() => {}} />
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
