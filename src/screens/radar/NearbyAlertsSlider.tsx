import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { WazeAlert } from '../../api/waze/types';
import type { NearbyAlert } from '../../engine/selectNearbyAlerts';
import { alertTypeMeta } from '../../theme/alertTypeMeta';
import { colors } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';
import { formatCompactDistance } from './formatCompactDistance';

interface NearbyAlertsSliderProps {
  nearbyAlerts: NearbyAlert[];
  onSelect: (alert: WazeAlert) => void;
}

/**
 * Drive screen's "nearby alerts" strip (Step 12 #25) - the 2 closest
 * alerts roughly ahead of the driver (see engine/selectNearbyAlerts.ts),
 * as tappable cards. A horizontal ScrollView nested inside DriveScreen's
 * vertical one is fine here (unlike the Report dial, which has to live
 * outside that ScrollView - see DriveScreen.tsx's comment on
 * reportSection): horizontal pan and vertical pan don't compete for the
 * same gesture the way a hold-to-confirm press does.
 */
export function NearbyAlertsSlider({ nearbyAlerts, onSelect }: NearbyAlertsSliderProps) {
  if (nearbyAlerts.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
    >
      {nearbyAlerts.map(({ alert, distanceMeters }) => {
        const meta = alertTypeMeta(alert.type);
        return (
          <Pressable
            key={alert.alert_id}
            onPress={() => onSelect(alert)}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel={`Zoom to ${meta.label} alert, ${formatCompactDistance(distanceMeters)} ahead`}
          >
            <Text style={styles.emoji}>{meta.emoji}</Text>
            <View style={styles.textBlock}>
              <Text style={styles.label}>{meta.label}</Text>
              <Text style={styles.distance}>{formatCompactDistance(distanceMeters)}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.backgroundAccent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(245, 245, 247, 0.12)',
  },
  emoji: {
    fontSize: 18,
    marginRight: 10,
  },
  textBlock: {},
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    color: colors.ink,
  },
  distance: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: colors.inkMuted,
  },
});
