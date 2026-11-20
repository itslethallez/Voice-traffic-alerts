import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { Card } from '../components/base/Card';
import { Column, Stack } from '../components/base/Layout';
import { colors, spacing, typography } from '../theme/tokens';

/**
 * Map data credits (Settings -> MAP DATA). Required, not decoration:
 * - Road matching runs on Shotgun's own Valhalla server built from
 *   OpenStreetMap (CLAUDE.md "Approved exceptions", 21 Nov 2026). The ODbL
 *   requires "© OpenStreetMap contributors" with a link to the licence.
 * - The map and place names are Mapbox (its logo/attribution control also
 *   stays on the map itself - RadarMap.tsx).
 */
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
export const MAPBOX_ATTRIBUTION = '© Mapbox';
export const MAPBOX_ATTRIBUTION_URL = 'https://www.mapbox.com/about/maps/';

function CreditLink({ label, url, purpose }: { label: string; url: string; purpose: string }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      accessibilityLabel={`${label} - ${purpose}. Opens ${url}`}
      style={({ pressed }) => [styles.credit, pressed && styles.pressed]}
    >
      <Column gap="xxs">
        <Text style={styles.creditLabel}>{label}</Text>
        <Text style={styles.purpose}>{purpose}</Text>
      </Column>
    </Pressable>
  );
}

export function AttributionCard() {
  return (
    <Card variant="outlined" padding="md">
      <Stack gap="sm">
        <CreditLink
          label={OSM_ATTRIBUTION}
          url={OSM_COPYRIGHT_URL}
          purpose="Road data for working out which alerts are on your road. Open Database License."
        />
        <CreditLink label={MAPBOX_ATTRIBUTION} url={MAPBOX_ATTRIBUTION_URL} purpose="Map display, place names and fallback routing." />
      </Stack>
    </Card>
  );
}

const styles = StyleSheet.create({
  credit: {
    paddingVertical: spacing.xxs,
  },
  pressed: {
    opacity: 0.7,
  },
  creditLabel: {
    fontFamily: typography.fontFamily.bodySemibold,
    fontSize: typography.fontSize.body,
    color: colors.accent,
  },
  purpose: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textSecondary,
  },
});
