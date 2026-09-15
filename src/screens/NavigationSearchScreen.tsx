import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin, X } from 'lucide-react-native';
import { fetchGeocode } from '../api/mapbox/client';
import type { MapboxGeocodeFeature } from '../api/mapbox/types';
import type { DriverState } from '../engine/types';
import { startNavigation } from '../navigation/navigationRuntime';
import { useNavigationStore } from '../store/useNavigationStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTripStore } from '../store/useTripStore';
import { hud, instrument } from '../theme/colors';
import { fontFamily } from '../theme/typography';

const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 3;

interface NavigationSearchScreenProps {
  onClose: () => void;
  /** Called once a destination has actually started navigating (not just
   * selected) so the caller can switch back to the map to show it - a
   * failed route fetch keeps this screen open with an inline error
   * instead. */
  onNavigationStarted: () => void;
}

function featureLabel(feature: MapboxGeocodeFeature): string {
  return feature.properties.full_address ?? feature.properties.name ?? feature.properties.place_formatted ?? 'Unnamed location';
}

/**
 * Destination entry for turn-by-turn navigation - forward-geocodes via
 * Mapbox (fetchGeocode, biased toward the driver's current position),
 * then hands the chosen result straight to navigationRuntime.startNavigation.
 * Reached from DriveScreen's top bar search button.
 */
export function NavigationSearchScreen({ onClose, onNavigationStarted }: NavigationSearchScreenProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MapboxGeocodeFeature[]>([]);
  const [searchState, setSearchState] = useState<'idle' | 'searching' | 'error'>('idle');
  const [startingId, setStartingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const driverPosition = useTripStore((state) => state.driverPosition);
  const driverHeadingDeg = useTripStore((state) => state.driverHeadingDeg);
  const driverSpeedKmh = useTripStore((state) => state.driverSpeedKmh);
  const avoidHazards = useSettingsStore((state) => state.avoidHazards);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const runSearch = useCallback(
    (text: string) => {
      const requestId = ++requestIdRef.current;
      if (text.trim().length < MIN_QUERY_LENGTH) {
        setResults([]);
        setSearchState('idle');
        return;
      }
      setSearchState('searching');
      fetchGeocode(text, { proximity: driverPosition ?? undefined })
        .then((features) => {
          if (requestId !== requestIdRef.current) return; // superseded by a newer keystroke
          setResults(features);
          setSearchState('idle');
        })
        .catch((error) => {
          if (requestId !== requestIdRef.current) return;
          console.warn('[navigation] destination search failed', error);
          setResults([]);
          setSearchState('error');
        });
    },
    [driverPosition]
  );

  const handleChangeText = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), SEARCH_DEBOUNCE_MS);
  };

  const handleSelect = async (feature: MapboxGeocodeFeature) => {
    if (!driverPosition || startingId) return;
    const id = feature.properties.mapbox_id ?? featureLabel(feature);
    setStartingId(id);

    const driver: DriverState = { position: driverPosition, headingDeg: driverHeadingDeg, speedKmh: driverSpeedKmh };
    const [longitude, latitude] = feature.geometry.coordinates;
    await startNavigation({ latitude, longitude }, featureLabel(feature), driver, { avoidHazards });

    setStartingId(null);
    if (useNavigationStore.getState().status === 'navigating') {
      onNavigationStarted();
    }
    // On failure, navigationRuntime already set status 'error' with a
    // message - stay on this screen; DriveScreen's NavigationStatusBar
    // isn't visible behind this modal, so the error needs to be readable
    // here too rather than only surfacing once the driver closes search.
  };

  const routingError = useNavigationStore((state) => (state.status === 'error' ? state.errorMessage : null));

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.title}>NAVIGATE</Text>
          <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close destination search">
            <X size={22} strokeWidth={2.2} color={instrument.paper} />
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={handleChangeText}
            placeholder="Search for a destination"
            placeholderTextColor={hud.muted}
            style={styles.input}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Destination search"
          />
        </View>

        {!driverPosition ? (
          <Text style={styles.notice}>Waiting for your location before searching nearby destinations.</Text>
        ) : null}
        {routingError ? <Text style={styles.errorText}>{routingError}</Text> : null}
        {searchState === 'error' ? <Text style={styles.errorText}>Search failed. Try again.</Text> : null}
        {searchState === 'searching' ? <ActivityIndicator style={styles.spinner} color={hud.accent} /> : null}

        <FlatList
          data={results}
          keyExtractor={(item, index) => item.properties.mapbox_id ?? `${index}`}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const id = item.properties.mapbox_id ?? featureLabel(item);
            const isStarting = startingId === id;
            return (
              <Pressable
                style={styles.resultRow}
                onPress={() => handleSelect(item)}
                disabled={startingId !== null}
                accessibilityRole="button"
                accessibilityLabel={`Navigate to ${featureLabel(item)}`}
              >
                <MapPin size={18} strokeWidth={2} color={hud.accent} />
                <Text style={styles.resultText} numberOfLines={2}>
                  {featureLabel(item)}
                </Text>
                {isStarting ? <ActivityIndicator color={hud.accent} /> : null}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: hud.ground,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: {
    fontFamily: fontFamily.black,
    fontSize: 18,
    letterSpacing: 1.5,
    color: instrument.paper,
  },
  searchRow: {
    marginHorizontal: 20,
    marginBottom: 12,
  },
  input: {
    height: 48,
    borderRadius: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: hud.rule,
    color: instrument.paper,
    fontFamily: fontFamily.medium,
    fontSize: 15,
  },
  notice: {
    marginHorizontal: 20,
    marginBottom: 8,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: hud.muted,
  },
  errorText: {
    marginHorizontal: 20,
    marginBottom: 8,
    fontFamily: fontFamily.bold,
    fontSize: 12,
    color: hud.sevHighText,
  },
  spinner: {
    marginBottom: 8,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: hud.rowRule,
  },
  resultText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 14,
    color: instrument.paper,
  },
});
