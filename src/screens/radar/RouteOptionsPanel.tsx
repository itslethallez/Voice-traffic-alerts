import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, RotateCcw, X } from 'lucide-react-native';
import { GlassView } from '../../components/base/GlassView';
import { Column, Row, Stack } from '../../components/base/Layout';
import { clearRouteOptions, confirmRouteSelection, loadRouteOptions, selectRouteOption } from '../../navigation/routeOptions';
import { useRouteOptionsStore, type RouteOptionId } from '../../store/useRouteOptionsStore';
import { useTripStore } from '../../store/useTripStore';
import { alpha, colors, radii, spacing, typography } from '../../theme/tokens';
import {
  buildRouteOptionReason,
  formatRouteDistance,
  formatRouteDuration,
  ROUTE_OPTION_COLORS,
  ROUTE_OPTION_LABELS,
} from './routeOptionPresentation';

const OPTION_ORDER: RouteOptionId[] = ['fastest', 'safest', 'sidestreets'];

/**
 * Stage B's route-choice surface - the bottom map overlay that replaces the
 * alerts sheet while a destination is being planned (DriveScreen swaps it
 * in whenever useRouteOptionsStore isn't idle). Three cards: FASTEST is
 * Mapbox's own pick, SAFEST is the least hazard-exposed of the same
 * alternatives (and says so honestly when that's the same geometry), SIDE
 * STREETS is the motorway-free request - shown unavailable rather than
 * faked when Mapbox couldn't produce one. Tapping a card only previews it
 * (re-tints the map line); the separate GO button is what commits via
 * routeOptions.ts's confirmRouteSelection -> navigationRuntime's
 * startNavigationWithRoute, which adopts the already-fetched geometry
 * rather than re-requesting Directions.
 */
export function RouteOptionsPanel() {
  const status = useRouteOptionsStore((state) => state.status);
  const destination = useRouteOptionsStore((state) => state.destination);
  const destinationLabel = useRouteOptionsStore((state) => state.destinationLabel);
  const options = useRouteOptionsStore((state) => state.options);
  const selectedId = useRouteOptionsStore((state) => state.selectedId);
  const errorMessage = useRouteOptionsStore((state) => state.errorMessage);
  const driverPosition = useTripStore((state) => state.driverPosition);

  const optionsById = new Map(options.map((option) => [option.id, option]));
  const selected = optionsById.get(selectedId ?? 'fastest') ?? null;

  const retry = () => {
    if (driverPosition && destination) {
      void loadRouteOptions(driverPosition, destination, destinationLabel);
    }
  };

  return (
    <GlassView intensity={45} dim={0.55} style={styles.panel}>
      <Stack gap="sm">
        <Row justify="space-between" align="center">
          <Column gap="xxs" flex={1}>
            <Text style={styles.eyebrow}>DESTINATION</Text>
            <Text style={styles.destination} numberOfLines={1}>
              {destinationLabel ?? 'Selected destination'}
            </Text>
          </Column>
          <Pressable
            onPress={clearRouteOptions}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Cancel route options"
            accessibilityHint="Clears the destination and returns to cruising"
          >
            <X size={18} strokeWidth={2.2} color={colors.textSecondary} />
          </Pressable>
        </Row>

        {status === 'loading' ? (
          <Row gap="sm" align="center">
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.statusText}>Finding routes…</Text>
          </Row>
        ) : null}

        {status === 'error' ? (
          <Stack gap="xs">
            <Text style={styles.errorText}>{errorMessage ?? 'Could not calculate routes.'}</Text>
            <Pressable
              onPress={retry}
              style={styles.retryButton}
              accessibilityRole="button"
              accessibilityLabel="Retry route search"
              accessibilityHint="Requests the route options again"
            >
              <Row gap="xs" align="center">
                <RotateCcw size={14} strokeWidth={2.4} color={colors.accent} />
                <Text style={styles.retryText}>RETRY</Text>
              </Row>
            </Pressable>
          </Stack>
        ) : null}

        {status === 'ready' ? (
          <Stack gap="xs">
            {OPTION_ORDER.map((id) => {
              const option = optionsById.get(id);
              const selected = selectedId === id;
              const reason = option ? buildRouteOptionReason(option, options) : 'No route without motorways';
              return (
                <Pressable
                  key={id}
                  disabled={!option}
                  onPress={() => option && selectRouteOption(id)}
                  style={[styles.card, selected && option && styles.cardSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: !option }}
                  accessibilityLabel={
                    option
                      ? `${ROUTE_OPTION_LABELS[id]} route, ${reason}, ${formatRouteDuration(
                          option.route.durationSeconds
                        )}, ${formatRouteDistance(option.route.distanceMeters)}`
                      : `${ROUTE_OPTION_LABELS[id]} route unavailable - ${reason}`
                  }
                >
                  <Row gap="sm" align="center">
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: ROUTE_OPTION_COLORS[id] },
                        !option && styles.dotMuted,
                      ]}
                    />
                    <Column gap="xxs" flex={1}>
                      <Text style={[styles.cardLabel, !option && styles.cardTextMuted]}>
                        {ROUTE_OPTION_LABELS[id]}
                      </Text>
                      <Text style={[styles.cardReason, !option && styles.cardTextMuted]} numberOfLines={2}>
                        {reason}
                      </Text>
                    </Column>
                    {option ? (
                      <Column gap="xxs" align="flex-end">
                        <Text style={styles.cardDuration}>{formatRouteDuration(option.route.durationSeconds)}</Text>
                        <Text style={styles.cardDistance}>{formatRouteDistance(option.route.distanceMeters)}</Text>
                      </Column>
                    ) : null}
                    {selected && option ? <Check size={16} strokeWidth={2.6} color={colors.accent} /> : null}
                  </Row>
                </Pressable>
              );
            })}
            {selected ? (
              <Pressable
                onPress={confirmRouteSelection}
                style={styles.goButton}
                accessibilityRole="button"
                accessibilityLabel={`Start navigation on the ${ROUTE_OPTION_LABELS[selected.id]} route`}
                accessibilityHint="Confirms the selected route and begins turn-by-turn guidance"
              >
                <Text style={styles.goButtonText}>
                  GO · {ROUTE_OPTION_LABELS[selected.id]} · {formatRouteDuration(selected.route.durationSeconds)}
                </Text>
              </Pressable>
            ) : null}
            <Text style={styles.hint}>Tap a route to preview it on the map, then GO to ride it.</Text>
          </Stack>
        ) : null}
      </Stack>
    </GlassView>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: alpha(colors.accent, 0.18),
  },
  eyebrow: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.accent,
  },
  destination: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.title,
    color: colors.textPrimary,
  },
  closeButton: {
    padding: spacing.xs,
  },
  statusText: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.body,
    color: colors.textSecondary,
  },
  errorText: {
    fontFamily: typography.fontFamily.bodySemibold,
    fontSize: typography.fontSize.caption,
    color: colors.caution,
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  retryText: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.accent,
  },
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: alpha(colors.accent, 0.14),
    backgroundColor: alpha(colors.charcoal, 0.35),
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  cardSelected: {
    borderColor: alpha(colors.accent, 0.65),
    backgroundColor: alpha(colors.accent, 0.12),
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radii.pill,
  },
  dotMuted: {
    opacity: 0.3,
  },
  cardLabel: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textPrimary,
  },
  cardTextMuted: {
    color: colors.textMuted,
  },
  cardReason: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textSecondary,
  },
  cardDuration: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.bodyLarge,
    color: colors.textPrimary,
  },
  cardDistance: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textMuted,
  },
  goButton: {
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  goButtonText: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.body,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.background,
  },
  hint: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textMuted,
  },
});
