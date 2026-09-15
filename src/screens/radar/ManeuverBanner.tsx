import { StyleSheet, Text, View } from 'react-native';
import { hud, instrument } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';
import { formatCompactDistance } from './formatCompactDistance';

interface ManeuverBannerProps {
  instruction: string;
  distanceMeters: number | null;
}

/**
 * The map's top status chip while navigating - replaces the plain compass
 * heading chip RadarMap.tsx otherwise shows there. Same position as that
 * chip, but the same visual weight as the existing RANGE badge
 * (rangeLabelBadge) rather than the small always-on heading pill: a turn
 * instruction is the single most important thing on screen while
 * navigating and should read that way.
 */
export function ManeuverBanner({ instruction, distanceMeters }: ManeuverBannerProps) {
  return (
    <View style={styles.root} pointerEvents="none">
      {distanceMeters !== null ? (
        <Text style={styles.distance}>{formatCompactDistance(distanceMeters).toUpperCase()}</Text>
      ) : null}
      <Text style={styles.instruction} numberOfLines={2}>
        {instruction.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 78,
    left: 16,
    right: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: hud.ground,
    borderWidth: 1,
    borderColor: hud.accent,
  },
  distance: {
    fontFamily: fontFamily.black,
    fontSize: 20,
    letterSpacing: 0.5,
    color: hud.accent,
  },
  instruction: {
    marginTop: 2,
    fontFamily: fontFamily.bold,
    fontSize: 13,
    letterSpacing: 0.5,
    color: instrument.paper,
  },
});
