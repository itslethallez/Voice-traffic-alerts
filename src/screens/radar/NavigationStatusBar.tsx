import { Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { stopNavigation } from '../../navigation/navigationRuntime';
import { useNavigationStore } from '../../store/useNavigationStore';
import { colors, radii, spacing, typography } from '../../theme/tokens';
import { formatArrivalTime } from './formatArrivalTime';
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
              {etaMs !== null ? ` · ARR ${formatArrivalTime(etaMs)}` : ''}
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
        <X size={18} strokeWidth={2.4} color={colors.textPrimary} />
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
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navigation,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  status: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.caption,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.navigation,
  },
  statusError: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.caption,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.critical,
  },
  eta: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.title,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textPrimary,
  },
  meta: {
    marginTop: spacing.xxs,
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.tight,
    color: colors.textMuted,
  },
  endButton: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.critical,
  },
  endButtonLabel: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textPrimary,
  },
});
