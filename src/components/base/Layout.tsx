import type { PropsWithChildren } from 'react';
import { View, type FlexStyle, type StyleProp, type ViewStyle } from 'react-native';
import { spacing, type SpacingKey } from '../../theme/tokens';

interface LayoutProps {
  /** Tokenised gap between children — a spacing step, never a raw number. */
  gap?: SpacingKey;
  align?: FlexStyle['alignItems'];
  justify?: FlexStyle['justifyContent'];
  wrap?: boolean;
  flex?: number;
  style?: StyleProp<ViewStyle>;
}

type LayoutConfig = Pick<LayoutProps, 'align' | 'justify' | 'wrap' | 'flex' | 'style'>;

function layoutStyle(
  direction: 'row' | 'column',
  { gap, align, justify, wrap, flex, style }: LayoutProps,
): StyleProp<ViewStyle> {
  return [
    {
      flexDirection: direction,
      gap: gap ? spacing[gap] : undefined,
      alignItems: align,
      justifyContent: justify,
      flexWrap: wrap ? 'wrap' : undefined,
      flex,
    },
    style,
  ];
}

/** Horizontal flex primitive. Replaces ad-hoc nested Views — pass a token
 * `gap` instead of hand-setting margins on children. */
export function Row(props: PropsWithChildren<LayoutProps>) {
  const { children, ...config } = props;
  return <View style={layoutStyle('row', config)}>{children}</View>;
}

/** Vertical flex primitive — same props as Row, column direction. */
export function Column(props: PropsWithChildren<LayoutProps>) {
  const { children, ...config } = props;
  return <View style={layoutStyle('column', config)}>{children}</View>;
}

/** Vertical stack with a default `md` gap — the go-to for stacking cards,
 * list rows and section blocks. Equivalent to Column but reads as intent:
 * "these are stacked items", not "this is a layout column". */
export function Stack({ gap = 'md', ...rest }: PropsWithChildren<LayoutProps>) {
  return <Column gap={gap} {...rest} />;
}