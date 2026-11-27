import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { WazeAlert } from '../../api/waze/types';
import { Column, Row } from '../../components/base/Layout';
import type { AlertFilterCategory } from '../../store/settingsDefaults';
import { colors, radii, sizes, typography } from '../../theme/tokens';
import { formatCompactDistance } from '../radar/formatCompactDistance';
import { alertVisual } from './alertVisual';

export interface AheadRowProps {
  alert: WazeAlert;
  category: AlertFilterCategory;
  /** "Speed camera · Main North Rd". */
  title: string;
  /** "12 min ago · Waze". */
  subtitle: string;
  distanceMeters: number | null;
  onPress: () => void;
}

/** One "Ahead of you" row (mockup board 1): tinted glyph tile, two lines, distance. */
export function AheadRow({ category, title, subtitle, distanceMeters, onPress }: AheadRowProps) {
  const visual = alertVisual(category);
  const distance = distanceMeters !== null ? formatCompactDistance(distanceMeters) : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}${distance ? `, ${distance} away` : ''}. Show on map.`}
    >
      <Row gap="sm" align="center">
        <View style={[styles.tile, { backgroundColor: visual.tint }]}>
          <visual.Icon size={18} strokeWidth={2.2} color={visual.color} />
        </View>
        <Column flex={1}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </Column>
        {distance ? <Text style={styles.distance}>{distance}</Text> : null}
      </Row>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: sizes.tileSm,
    height: sizes.tileSm,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: typography.fontFamily.bodyBold,
    fontSize: typography.fontSize.label,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textSecondary,
  },
  distance: {
    fontFamily: typography.fontFamily.bodyBold,
    fontSize: typography.fontSize.label,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
});
