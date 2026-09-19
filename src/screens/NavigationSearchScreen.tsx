import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  BedDouble,
  Building2,
  BusFront,
  Church,
  Coffee,
  Dumbbell,
  Fuel,
  GraduationCap,
  Hospital,
  Landmark,
  MapPin,
  Plane,
  Sailboat,
  Search,
  ShoppingCart,
  SquareParking,
  TrainFront,
  TramFront,
  TreePine,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { fetchSearchSuggestions, retrieveSuggestion } from '../api/mapbox/client';
import type { MapboxSearchSuggestion } from '../api/mapbox/types';
import { GlassView } from '../components/base/GlassView';
import { Column, Row, Stack } from '../components/base/Layout';
import { ScreenContainer } from '../components/base/ScreenContainer';
import { loadRouteOptions } from '../navigation/routeOptions';
import { useTripStore } from '../store/useTripStore';
import { colors, radii, spacing, typography } from '../theme/tokens';

const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 3;
const RESULT_LIMIT = 8;

interface NavigationSearchScreenProps {
  onClose: () => void;
}

const FEATURE_TYPE_LABELS: Record<string, string> = {
  poi: 'Place',
  address: 'Address',
  street: 'Street',
  place: 'Suburb / town',
  city: 'Town',
  locality: 'Locality',
  neighborhood: 'Neighbourhood',
  district: 'District',
  postcode: 'Postcode',
};

/** Canonical poi_category_id substring -> icon. Matched in order, so more
 * specific ids should come before the generic ones that contain them
 * (e.g. 'train_station' before 'station' would matter if both listed). */
const CATEGORY_ICONS: [RegExp, LucideIcon][] = [
  [/train|railway/, TrainFront],
  [/tram|light_rail/, TramFront],
  [/bus|transit|shuttle/, BusFront],
  [/parking/, SquareParking],
  // \b keeps 'park' from matching inside 'parking' (checked above anyway).
  [/\bpark|garden|playground|national|reserve/, TreePine],
  [/beach|bay|surf|marina/, Sailboat],
  [/restaurant|food|pizza|burger|fast_food|bar|pub|wine|beer|bakery|deli/, UtensilsCrossed],
  [/cafe|coffee/, Coffee],
  [/fuel|gas|petrol|charging/, Fuel],
  [/supermarket|grocery|shopping|mall|store|market|shop/, ShoppingCart],
  [/hospital|doctor|pharmacy|medical|clinic|dentist|vet/, Hospital],
  [/school|university|college|education|library/, GraduationCap],
  [/hotel|lodging|motel|accommodation|hostel/, BedDouble],
  [/museum|gallery|theatre|theater|cinema|arts|landmark|monument|tourist|attraction|zoo/, Landmark],
  [/church|worship|temple|mosque|synagogue/, Church],
  [/airport|airfield/, Plane],
  [/sport|gym|fitness|stadium|swimming|pool|golf/, Dumbbell],
  [/office|building|government/, Building2],
];

function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Park", "Train station", "Address" - the type line under each result's
 * name. POIs prefer Mapbox's own display category over the coarse
 * feature_type. */
function suggestionTypeLabel(suggestion: MapboxSearchSuggestion): string {
  const category = suggestion.poi_category?.[0] ?? suggestion.poi_category_ids?.[0]?.replace(/_/g, ' ');
  if (category) return titleCase(category);
  return FEATURE_TYPE_LABELS[suggestion.feature_type] ?? 'Place';
}

function suggestionIcon(suggestion: MapboxSearchSuggestion): LucideIcon {
  const categories = suggestion.poi_category_ids ?? [];
  for (const id of categories) {
    for (const [pattern, icon] of CATEGORY_ICONS) {
      if (pattern.test(id)) return icon;
    }
  }
  return MapPin;
}

/** /suggest's `distance` is already approximate (metres from the proximity
 * point) - rounded further for display since precision here is false. */
function formatDistance(meters: number | undefined): string | null {
  if (meters === undefined) return null;
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

/**
 * Navigate mode's Stage A: destination search. Autocomplete-as-you-type
 * via Mapbox Search Box /suggest (addresses + businesses + named places in
 * one query, proximity-biased to the driver), then /retrieve resolves the
 * pick into coordinates. A confirmed pick hands straight off to Stage B -
 * navigation/routeOptions.ts's loadRouteOptions - and this screen closes
 * back to the map, where the route-options panel takes over.
 */
export function NavigationSearchScreen({ onClose }: NavigationSearchScreenProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MapboxSearchSuggestion[]>([]);
  const [searchState, setSearchState] = useState<'idle' | 'searching' | 'error'>('idle');
  const [retrievingId, setRetrievingId] = useState<string | null>(null);
  const [retrieveError, setRetrieveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  /** Lazily minted (Crypto.randomUUID) so mounting this screen costs no
   * session; reset to null after every retrieve so the next search bills
   * as its own session. */
  const sessionTokenRef = useRef<string | null>(null);

  const driverPosition = useTripStore((state) => state.driverPosition);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const sessionToken = () => (sessionTokenRef.current ??= Crypto.randomUUID());

  const runSearch = useCallback(
    (text: string) => {
      const requestId = ++requestIdRef.current;
      if (text.trim().length < MIN_QUERY_LENGTH) {
        setResults([]);
        setSearchState('idle');
        return;
      }
      setSearchState('searching');
      fetchSearchSuggestions(text, {
        sessionToken: sessionToken(),
        proximity: driverPosition ?? undefined,
        limit: RESULT_LIMIT,
      })
        .then((suggestions) => {
          if (requestId !== requestIdRef.current) return; // superseded by a newer keystroke
          setResults(suggestions);
          setSearchState('idle');
        })
        .catch((error) => {
          if (requestId !== requestIdRef.current) return;
          console.warn('[navigate] destination search failed', error);
          setResults([]);
          setSearchState('error');
        });
    },
    [driverPosition]
  );

  const handleChangeText = (text: string) => {
    setQuery(text);
    setRetrieveError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < MIN_QUERY_LENGTH) {
      requestIdRef.current += 1; // cancel any in-flight suggest
      setResults([]);
      setSearchState('idle');
      return;
    }
    // Show the spinner from the first keystroke rather than only once the
    // debounce fires - the request is coming, this is just its latency.
    setSearchState('searching');
    debounceRef.current = setTimeout(() => runSearch(text), SEARCH_DEBOUNCE_MS);
  };

  const handleSelect = async (suggestion: MapboxSearchSuggestion) => {
    if (retrievingId) return;
    const requestId = ++requestIdRef.current; // invalidate any suggest still in flight
    setRetrievingId(suggestion.mapbox_id);
    setRetrieveError(null);

    try {
      const feature = await retrieveSuggestion(suggestion.mapbox_id, { sessionToken: sessionToken() });
      if (requestId !== requestIdRef.current) return;
      const coordinates = feature?.geometry.coordinates;
      if (!coordinates) {
        setRetrieveError(`Couldn't pin down "${suggestion.name}" - try another result.`);
        return;
      }
      const [longitude, latitude] = coordinates;
      if (!driverPosition) {
        // Rows are disabled until a position exists, so this only fires
        // from the submit-shortcut path - never silently drop the pick.
        setRetrieveError('Waiting for your location before routes can be calculated.');
        return;
      }
      // Stage B handoff: loadRouteOptions owns the fetch + hazard scoring
      // and drives the route-options panel on the map screen this closes
      // back to.
      void loadRouteOptions(
        driverPosition,
        { latitude, longitude },
        suggestion.name_preferred ?? suggestion.name
      );
      onClose();
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      console.warn('[navigate] failed to resolve selected suggestion', error);
      setRetrieveError('Couldn\'t load that result - try again.');
    } finally {
      // Always cleared - even when this retrieve was superseded (the guard
      // at the top keeps retrieves serial, so nothing else can own it).
      setRetrievingId(null);
      // The suggest+retrieve session is over either way - the next search
      // starts a fresh billing session.
      sessionTokenRef.current = null;
    }
  };

  const clearQuery = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    requestIdRef.current += 1;
    setQuery('');
    setResults([]);
    setSearchState('idle');
  };

  const showEmpty = searchState === 'idle' && results.length === 0 && query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <ScreenContainer edges={['top', 'left', 'right', 'bottom']}>
      <Stack gap="md" flex={1}>
        <Row justify="space-between" align="center">
          <Text style={styles.title}>NAVIGATE</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close destination search">
            <GlassView intensity={40} dim={0.4} style={styles.closeButton}>
              <X size={20} strokeWidth={2.2} color={colors.textPrimary} />
            </GlassView>
          </Pressable>
        </Row>

        <GlassView intensity={40} dim={0.45} style={styles.searchCard}>
          <Row gap="sm" align="center">
            <Search size={18} strokeWidth={2.2} color={colors.accent} />
            <TextInput
              value={query}
              onChangeText={handleChangeText}
              onSubmitEditing={() => {
                const first = results[0];
                if (first) void handleSelect(first);
              }}
              placeholder="Address, business, or place"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Destination search"
            />
            {searchState === 'searching' ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : query.length > 0 ? (
              <Pressable onPress={clearQuery} hitSlop={12} accessibilityRole="button" accessibilityLabel="Clear search">
                <X size={16} strokeWidth={2.2} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </Row>
        </GlassView>

        {!driverPosition ? (
          <Text style={styles.notice}>Waiting for your location - needed to pick a route.</Text>
        ) : null}
        {searchState === 'error' ? <Text style={styles.errorText}>Search failed. Try again.</Text> : null}
        {retrieveError ? <Text style={styles.errorText}>{retrieveError}</Text> : null}

        {results.length > 0 ? (
          <GlassView intensity={40} dim={0.4} style={styles.resultsCard}>
            <FlatList
              data={results}
              keyExtractor={(item) => item.mapbox_id}
              keyboardShouldPersistTaps="handled"
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              renderItem={({ item }) => {
                const Icon = suggestionIcon(item);
                const isRetrieving = retrievingId === item.mapbox_id;
                const distance = formatDistance(item.distance);
                const context = item.place_formatted ?? item.address ?? item.full_address ?? '';
                return (
                  <Pressable
                    style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
                    onPress={() => void handleSelect(item)}
                    disabled={retrievingId !== null || !driverPosition}
                    accessibilityRole="button"
                    accessibilityLabel={`Set destination to ${item.name}`}
                  >
                    <Icon size={20} strokeWidth={2} color={colors.accent} />
                    <Column gap="xxs" flex={1}>
                      <Text style={styles.resultName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.resultMeta} numberOfLines={1}>
                        {suggestionTypeLabel(item)}
                        {context ? ` · ${context}` : ''}
                      </Text>
                    </Column>
                    {isRetrieving ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : distance ? (
                      <Text style={styles.resultDistance}>{distance}</Text>
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </GlassView>
        ) : showEmpty ? (
          <Text style={styles.notice}>No matches for "{query.trim()}".</Text>
        ) : null}
      </Stack>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.title,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textPrimary,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 32,
    color: colors.textPrimary,
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: typography.fontSize.body,
    paddingVertical: 0, // RN TextInput adds its own vertical padding on Android
    // RNW leaves the platform's own input chrome (white fill + border +
    // focus ring) on the element - strip it so the glass card reads as
    // the field.
    backgroundColor: 'transparent',
    borderWidth: 0,
    outlineWidth: 0,
  },
  notice: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textMuted,
  },
  errorText: {
    fontFamily: typography.fontFamily.bodySemibold,
    fontSize: typography.fontSize.caption,
    color: colors.caution,
  },
  resultsCard: {
    flex: 1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resultRowPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  resultName: {
    fontFamily: typography.fontFamily.bodySemibold,
    fontSize: typography.fontSize.body,
    color: colors.textPrimary,
  },
  resultMeta: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textSecondary,
  },
  resultDistance: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.bodyLarge,
    color: colors.textSecondary,
  },
});
