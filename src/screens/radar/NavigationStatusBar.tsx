import { Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { stopNavigation } from '../../navigation/navigationRuntime';
import { useNavigationStore } from '../../store/useNavigationStore';
import { hud, instrument } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';
import { formatCompactDistance } from './formatCompactDistance';

function formatMinutesRemaining(etaMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.round((etaMs - nowMs) / 60_000));
  return `${minutes} MIN`;
}

/**
 * DriveScreen's own bottom strip while navigating - sits above the
 * existing Report/Range/Mute/Speedometer row rather than replacing it,
 * since muting or filing a report is still useful mid-navigation. Reads
 * useNavigationStore directly rather than through props, and renders
 * nothing at all outside every non-'idle' status, so mounting it
 * unconditionally in DriveScreen costs nothing the rest of the time.
 */
export function NavigationStatusBar({ nowMs }: { nowMs: number }) {
  const status = useNavigationStore((state) => state.status);
  const destinationLabel = useNavigationStore((state) => state.destinationLabel);
  const remainingDistanceM = useNavigationStore((state) => state.remainingDistanceM);
  const etaMs = useNavigationStore((state) => state.etaMs);
  const errorMessage = useNavigationStore((state) => state.errorMessage);

  if (status === 'idle') return null;

  return (
    <View style={styles.root}>
      <View style={styles.info}>
        {status === 'routing' ? (
          <Text style={styles.status}>FINDING A ROUTE…</Text>
        ) : status === 'error' ? (
          <Text style={styles.statusError} numberOfLines={1}>
            {errorMessage ?? 'COULD NOT ROUTE THERE'}
          </Text>
        ) : (
          <>
            <Text style={styles.eta}>
              {etaMs !== null ? formatMinutesRemaining(etaMs, nowMs) : '—'}
              {status === 'rerouting' ? ' · REROUTING…' : ''}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {remainingDistanceM !== null ? formatCompactDistance(remainingDistanceM).toUpperCase() : ''}
              {destinationLabel ? ` · ${destinationLabel.toUpperCase()}` : ''}
            </Text>
          </>
        )}
      </View>
      <Pressable
        onPress={() => stopNavigation()}
        style={styles.endButton}
        accessibilityRole="button"
        accessibilityLabel="End navigation"
      >
        <X size={18} strokeWidth={2.4} color={instrument.paper} />
        <Text style={styles.endButtonLabel}>END</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginHorizontal: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: hud.ground,
    borderWidth: 1,
    borderColor: hud.accent,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  status: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    letterSpacing: 1,
    color: hud.accent,
  },
  statusError: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    letterSpacing: 0.5,
    color: hud.sevHighText,
  },
  eta: {
    fontFamily: fontFamily.black,
    fontSize: 16,
    letterSpacing: 0.5,
    color: instrument.paper,
  },
  meta: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 11,
    letterSpacing: 0.5,
    color: hud.muted,
  },
  endButton: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: hud.sevHighText,
  },
  endButtonLabel: {
    fontFamily: fontFamily.black,
    fontSize: 11,
    letterSpacing: 1,
    color: instrument.paper,
  },
});
