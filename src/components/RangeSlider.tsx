import { useCallback, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { instrument } from '../theme/colors';
import { fontFamily } from '../theme/typography';

const THUMB_WIDTH = 6;
const TRACK_HEIGHT = 18;

export interface RangeSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  minLabel: string;
  maxLabel: string;
}

/**
 * The Instrument redesign's flat track-and-square-thumb slider
 * (design_handoff_instrument_face), used for Settings' Range rows and the
 * Volume/Rate expand-in-place. Not `@react-native-community/slider` - that
 * library can't reliably produce a flush square thumb or the segmented-line
 * look cross-platform, so this drives the exact geometry from the design
 * artboard directly via PanResponder: a 2px faint base line, a 2px filled
 * line to the current fraction, and a 6x18 square thumb centred on it.
 */
export function RangeSlider({ value, min, max, step, onChange, minLabel, maxLabel }: RangeSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const valueFromX = useCallback(
    (x: number) => {
      if (trackWidth <= 0) return value;
      const fraction = Math.min(1, Math.max(0, x / trackWidth));
      const raw = min + fraction * (max - min);
      const stepped = Math.round(raw / step) * step;
      return Math.min(max, Math.max(min, stepped));
    },
    [trackWidth, min, max, step, value]
  );

  // Ref-mirrored so the PanResponder (created once) always calls through to
  // the latest closure instead of a stale one from whichever render it was
  // constructed in.
  const latestRef = useRef({ valueFromX, onChange });
  latestRef.current = { valueFromX, onChange };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        latestRef.current.onChange(latestRef.current.valueFromX(evt.nativeEvent.locationX));
      },
      onPanResponderMove: (evt) => {
        latestRef.current.onChange(latestRef.current.valueFromX(evt.nativeEvent.locationX));
      },
    })
  ).current;

  const clampedValue = Math.min(max, Math.max(min, value));
  const fraction = max > min ? (clampedValue - min) / (max - min) : 0;
  const thumbLeft = Math.max(0, Math.min(trackWidth - THUMB_WIDTH, fraction * trackWidth - THUMB_WIDTH / 2));

  return (
    <View>
      <View style={styles.touchArea} onLayout={handleLayout} {...panResponder.panHandlers}>
        <View style={styles.track} pointerEvents="none">
          <View style={styles.baseLine} />
          <View style={[styles.filledLine, { width: `${fraction * 100}%` }]} />
          <View style={[styles.thumb, { left: thumbLeft }]} />
        </View>
      </View>
      <View style={styles.labelsRow}>
        <Text style={styles.label}>{minLabel}</Text>
        <Text style={styles.label}>{maxLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  touchArea: {
    paddingVertical: 8,
  },
  track: {
    height: TRACK_HEIGHT,
    justifyContent: 'center',
  },
  baseLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: instrument.faintOnInk,
  },
  filledLine: {
    position: 'absolute',
    left: 0,
    height: 2,
    backgroundColor: instrument.paper,
  },
  thumb: {
    position: 'absolute',
    top: 0,
    width: THUMB_WIDTH,
    height: TRACK_HEIGHT,
    backgroundColor: instrument.paper,
  },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    letterSpacing: 1,
    color: instrument.tickOnInk,
  },
});
