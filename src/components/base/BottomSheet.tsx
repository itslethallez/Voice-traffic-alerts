import { useRef, type PropsWithChildren, type ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radii, spacing } from '../../theme/tokens';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const HANDLE_ZONE_HEIGHT = 28;
const FLING_VELOCITY = 0.4;

export type SheetSnap = 'collapsed' | 'expanded';

export interface BottomSheetProps {
  /** Height of the strip still visible when collapsed — the mockups' "5
   * alerts nearby" peek. */
  peekHeight?: number;
  /** Sheet height when fully expanded. Defaults to ~62% of the window. */
  expandedHeight?: number;
  /** Content rendered between the grabber and the scrollable body — the
   * sheet's title row ("5 alerts nearby · Live"). Kept inside the drag
   * zone so the header itself is draggable. */
  header?: ReactNode;
  initialSnap?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Draggable bottom sheet for the nearby-alerts list and route details.
 * Two snap points: collapsed (peek) and expanded. Driven by PanResponder +
 * Animated — deliberately not react-native-gesture-handler/reanimated,
 * matching RangeSlider's precedent of driving gestures without adding the
 * native gesture stack.
 *
 * NOTE: uses absolute positioning to anchor to the parent's bottom edge —
 * this component and MapOverlayPanel are the sanctioned exceptions to the
 * no-absolute rule, since a sheet overlaying the map can't be expressed in
 * normal flow.
 */
export function BottomSheet({
  peekHeight = 140,
  expandedHeight = Math.round(WINDOW_HEIGHT * 0.62),
  header,
  initialSnap = 'collapsed',
  onSnapChange,
  style,
  children,
}: PropsWithChildren<BottomSheetProps>) {
  const collapsedY = Math.max(0, expandedHeight - peekHeight);
  const collapsedYRef = useRef(collapsedY);
  collapsedYRef.current = collapsedY;

  const translateY = useRef(new Animated.Value(initialSnap === 'expanded' ? 0 : collapsedY)).current;
  const currentY = useRef(initialSnap === 'expanded' ? 0 : collapsedY);
  const gestureStartY = useRef(0);
  const snapRef = useRef(initialSnap);
  const onSnapChangeRef = useRef(onSnapChange);
  onSnapChangeRef.current = onSnapChange;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        gestureStartY.current = currentY.current;
        translateY.stopAnimation();
      },
      onPanResponderMove: (_evt, gesture) => {
        const next = Math.min(collapsedYRef.current, Math.max(0, gestureStartY.current + gesture.dy));
        translateY.setValue(next);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const projected = gestureStartY.current + gesture.dy;
        let snap: SheetSnap;
        if (gesture.vy < -FLING_VELOCITY) snap = 'expanded';
        else if (gesture.vy > FLING_VELOCITY) snap = 'collapsed';
        else snap = projected < collapsedYRef.current / 2 ? 'expanded' : 'collapsed';

        const target = snap === 'expanded' ? 0 : collapsedYRef.current;
        currentY.current = target;
        Animated.spring(translateY, {
          toValue: target,
          useNativeDriver: true,
          damping: 22,
          stiffness: 220,
          mass: 0.9,
        }).start();
        if (snapRef.current !== snap) {
          snapRef.current = snap;
          onSnapChangeRef.current?.(snap);
        }
      },
    })
  ).current;

  return (
    <Animated.View
      style={[
        styles.sheet,
        { height: expandedHeight, transform: [{ translateY }] },
        style,
      ]}
    >
      <View style={styles.handleZone} {...panResponder.panHandlers}>
        <View style={styles.grabber} />
        {header}
      </View>
      <View style={styles.body}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  handleZone: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.screenPadding,
    minHeight: HANDLE_ZONE_HEIGHT,
    gap: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.slate,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.lg,
  },
});
