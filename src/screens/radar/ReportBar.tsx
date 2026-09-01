import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CarFront, Siren, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { useTripStore, type ManualReportCategory } from '../../store/useTripStore';
import { hud, instrument } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';

const ICON_SIZE = 30;
const ICON_STROKE_WIDTH = 2;

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
  gradient: readonly [string, string];
}

const CELLS: ReportCellDef[] = [
  {
    category: 'POLICE',
    label: 'POLICE',
    Icon: Siren,
    stroke: hud.sevHighText,
    gradient: ['rgba(224,27,36,0.22)', 'rgba(224,27,36,0.06)'],
  },
  {
    category: 'ACCIDENT',
    label: 'ACCIDENT',
    Icon: CarFront,
    stroke: hud.accentBright,
    gradient: ['#14395C', '#0A2338'],
  },
  {
    category: 'HAZARD',
    label: 'HAZARD',
    Icon: TriangleAlert,
    stroke: hud.sevMed,
    gradient: ['rgba(232,147,12,0.18)', 'rgba(232,147,12,0.05)'],
  },
];

/**
 * The Radio screen's always-on report control (`BUILD PROMPT - HUD face.md`,
 * "Report bar") - replaces the old single expand-to-pick ReportButton with
 * three permanently visible cells, each a direct one-tap file at the
 * driver's current position via useTripStore's pushManualReport. No
 * category/subtype picker step (including for POLICE, which previously
 * required a second Visible/Hidden tap) - undo is the safety net instead of
 * a confirm-before-file step, via removeManualReport within
 * UNDO_WINDOW_MS.
 */
export function ReportBar() {
  return (
    <View style={styles.root}>
      {CELLS.map((cell, index) => (
        <ReportCell key={cell.category} def={cell} isFirst={index === 0} />
      ))}
    </View>
  );
}

function ReportCell({ def, isFirst }: { def: ReportCellDef; isFirst: boolean }) {
  const pushManualReport = useTripStore((state) => state.pushManualReport);
  const removeManualReport = useTripStore((state) => state.removeManualReport);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (undoTimeoutRef.current !== null) clearTimeout(undoTimeoutRef.current);
    },
    []
  );

  const handlePress = useCallback(() => {
    if (pendingKey) {
      if (undoTimeoutRef.current !== null) {
        clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = null;
      }
      removeManualReport(pendingKey);
      setPendingKey(null);
      return;
    }

    const localKey = pushManualReport(def.category, null);
    setPendingKey(localKey);
    undoTimeoutRef.current = setTimeout(() => {
      setPendingKey(null);
      undoTimeoutRef.current = null;
    }, UNDO_WINDOW_MS);
  }, [pendingKey, pushManualReport, removeManualReport, def.category]);

  const isPending = pendingKey !== null;
  const { Icon } = def;

  return (
    <Pressable
      onPress={handlePress}
      style={[styles.cell, !isFirst && styles.cellDivider]}
      accessibilityRole="button"
      accessibilityLabel={isPending ? `Undo ${def.label.toLowerCase()} report` : `Report ${def.label.toLowerCase()}`}
    >
      <LinearGradient colors={def.gradient} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} color={isPending ? instrument.paper : def.stroke} />
      <Text style={styles.label}>{isPending ? 'UNDO' : def.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    height: 84,
    flexGrow: 0,
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: hud.rule,
  },
  cell: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  cellDivider: {
    borderLeftWidth: 1,
    borderLeftColor: hud.rule,
  },
  label: {
    fontFamily: fontFamily.black,
    fontSize: 13,
    letterSpacing: 1,
    color: hud.rowTitle,
  },
});
