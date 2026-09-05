import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CarFront, Plus, Siren, TrafficCone, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { useTripStore, type ManualReportCategory } from '../../store/useTripStore';
import { hud, instrument } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';

const ICON_SIZE = 22;
const ICON_STROKE_WIDTH = 2;
/** Matches Speedometer's circular footprint (design reference: the
 * REPORT dial and speedometer are the same size, mirrored left/right in
 * the bottom bar) - see REPORT_DIAL_SIZE's doc comment on why this is a
 * fixed diameter rather than flex-sized like the old always-on bar. */
const REPORT_DIAL_SIZE = 112;
const CATEGORY_BUTTON_SIZE = 56;

/** How long a just-filed cell offers UNDO before reverting to its resting
 * label - long enough to catch a second glance-free tap, short enough that
 * it never lingers as a stale affordance for a report the driver meant to
 * keep. */
const UNDO_WINDOW_MS = 4000;

interface ReportCellDef {
  category: ManualReportCategory;
  label: string;
  Icon: LucideIcon;
  stroke: string;
}

const CELLS: ReportCellDef[] = [
  { category: 'POLICE', label: 'POLICE', Icon: Siren, stroke: hud.sevHighText },
  { category: 'ACCIDENT', label: 'ACCIDENT', Icon: CarFront, stroke: hud.accentBright },
  { category: 'HAZARD', label: 'HAZARD', Icon: TriangleAlert, stroke: hud.sevMed },
  {
    // JAM is already a first-class alert type. This cast keeps the requested
    // UI-only change local while the older manual-report store type catches up.
    category: 'JAM' as ManualReportCategory,
    label: 'JAM',
    Icon: TrafficCone,
    stroke: '#F5C451',
  },
];

/**
 * The Drive screen's report control (2026-09 redesign: a single circular
 * REPORT dial, the same footprint as Speedometer and mirrored to its
 * opposite side, replacing the old always-visible 4-cell bar). Tapping the
 * dial fans the four category buttons out above it (design reference:
 * the dotted-line radial layout); tapping a category files the report via
 * useTripStore's pushManualReport and collapses back to the resting dial.
 * Tapping the dial again while expanded collapses it with no report filed.
 */
export function ReportBar() {
  const [expanded, setExpanded] = useState(false);
  const pushManualReport = useTripStore((state) => state.pushManualReport);
  const removeManualReport = useTripStore((state) => state.removeManualReport);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (undoTimeoutRef.current !== null) clearTimeout(undoTimeoutRef.current);
    },
    []
  );

  const handleCategoryPress = useCallback(
    (def: ReportCellDef) => {
      const localKey = pushManualReport(def.category, null);
      setPendingKey(localKey);
      setPendingLabel(def.label);
      setExpanded(false);
      undoTimeoutRef.current = setTimeout(() => {
        setPendingKey(null);
        setPendingLabel(null);
        undoTimeoutRef.current = null;
      }, UNDO_WINDOW_MS);
    },
    [pushManualReport]
  );

  const handleUndo = useCallback(() => {
    if (!pendingKey) return;
    if (undoTimeoutRef.current !== null) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    removeManualReport(pendingKey);
    setPendingKey(null);
    setPendingLabel(null);
  }, [pendingKey, removeManualReport]);

  const isPending = pendingKey !== null;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {expanded ? (
        <View style={styles.fanOut} pointerEvents="box-none">
          {CELLS.map((cell) => (
            <CategoryButton key={cell.category} def={cell} onPress={() => handleCategoryPress(cell)} />
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={isPending ? handleUndo : () => setExpanded((current) => !current)}
        style={[styles.dial, expanded && styles.dialExpanded, isPending && styles.dialPending]}
        accessibilityRole="button"
        accessibilityLabel={
          isPending
            ? `Undo ${pendingLabel?.toLowerCase()} report`
            : expanded
              ? 'Close report menu'
              : 'Report an incident'
        }
        accessibilityState={{ expanded }}
      >
        {isPending ? (
          <Text style={styles.dialLabel}>UNDO</Text>
        ) : (
          <>
            <Plus
              size={28}
              strokeWidth={2.4}
              color={hud.accentBright}
              style={expanded ? styles.plusRotated : undefined}
            />
            <Text style={styles.dialLabel}>REPORT</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

function CategoryButton({ def, onPress }: { def: ReportCellDef; onPress: () => void }) {
  const { Icon } = def;
  return (
    <Pressable
      onPress={onPress}
      style={styles.categoryButton}
      accessibilityRole="button"
      accessibilityLabel={`Report ${def.label.toLowerCase()}`}
    >
      <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} color={def.stroke} />
      <Text style={styles.categoryLabel} numberOfLines={1}>
        {def.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    width: REPORT_DIAL_SIZE,
    alignItems: 'center',
  },
  dial: {
    width: REPORT_DIAL_SIZE,
    height: REPORT_DIAL_SIZE,
    borderRadius: REPORT_DIAL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(6, 20, 24, 0.96)',
    borderWidth: 2,
    borderColor: hud.accentBright,
  },
  dialExpanded: {
    borderColor: hud.accent,
  },
  dialPending: {
    backgroundColor: instrument.ink,
    borderColor: instrument.paper,
  },
  plusRotated: {
    transform: [{ rotate: '45deg' }],
  },
  dialLabel: {
    fontFamily: fontFamily.black,
    fontSize: 12,
    letterSpacing: 1,
    color: hud.rowTitle,
  },
  fanOut: {
    position: 'absolute',
    bottom: REPORT_DIAL_SIZE + 12,
    alignItems: 'center',
    gap: 10,
  },
  categoryButton: {
    width: CATEGORY_BUTTON_SIZE,
    height: CATEGORY_BUTTON_SIZE,
    borderRadius: CATEGORY_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: 'rgba(6, 20, 24, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(150, 210, 204, 0.4)',
  },
  categoryLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 7,
    letterSpacing: 0.4,
    color: hud.rowTitle,
  },
});
