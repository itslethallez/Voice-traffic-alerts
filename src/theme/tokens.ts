/**
 * Shotgun design-system tokens — the single source of truth for the UI
 * rebuild. Values come from the official brand board
 * (design-reference/design-reference-export/04-brand-board-colors-typography.png)
 * and the Cruising/Navigate mockups, not from `colors.ts` — the legacy
 * `colors` / `instrument` / `hud` palettes stay untouched for the screens
 * still using them, and are not imported here.
 */

const palette = {
  charcoal: '#0B0F12', // Base / background
  asphalt: '#1F262C', // UI surfaces
  slate: '#3A454E', // Secondary
  teal: '#00E5D6', // Primary / brand
  coolBlue: '#3BA3FF', // Navigation / tech
  amber: '#FFB020', // Caution / warnings
  red: '#FF3B30', // Critical alerts only
  /** Animal / roadkill hazards — their own green per the 3D design guide
   * (was sharing the brand teal, which made the category indistinguishable
   * from Shotgun's primary accent). */
  roadkill: '#26D99A',
  white: '#FFFFFF', // Text / icons
} as const;

export const colors = {
  ...palette,
  /** Secondary copy — cool grey over charcoal, sampled from the mockups'
   * subtitle/meta text. */
  textSecondary: '#9AA7B0',
  /** Tertiary copy — timestamps, captions, inactive labels. */
  textMuted: '#5C6870',
  // Semantic aliases — screens should prefer these over raw palette names.
  background: palette.charcoal,
  surface: palette.asphalt,
  surfaceRaised: '#27313A', // cards/sheets sitting on top of `surface`
  border: 'rgba(154, 167, 176, 0.16)', // 1px hairlines on dark surfaces
  borderStrong: palette.slate,
  accent: palette.teal,
  navigation: palette.coolBlue,
  caution: palette.amber,
  critical: palette.red,
  textPrimary: palette.white,
} as const;

/**
 * Mapbox style-paint values for the 3D world treatment (3D design guide
 * §3): charcoal/graphite buildings, terrain shading and a restrained
 * horizon atmosphere. Kept separate from `colors` — these style the map
 * canvas itself, not app UI surfaces, and are consumed by RadarMap on
 * both native (@rnmapbox) and web (mapbox-gl).
 */
export const map3d = {
  /** Charcoal/graphite building extrusion — low saturation, sits under
   * road labels. */
  building: '#161B21',
  /** Hillshade relief colours — shadow deepens slopes, highlight lifts
   * ridges just enough to read hills on a near-black base. */
  hillshadeShadow: '#04070A',
  hillshadeHighlight: '#1B2A33',
  /** Horizon atmosphere — a very subtle lift toward the horizon, never a
   * bright game-like sky. */
  atmosphereHorizon: '#10161C',
  atmosphereHigh: '#0A0F14',
  atmosphereSpace: '#04070A',
} as const;

/** Multiplies a palette hex (#RRGGBB) by `opacity` into an rgba() string. */
export function alpha(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  /** Standard outer padding applied by ScreenContainer on every screen. */
  screenPadding: 20,
} as const;

/** Gap steps accepted by the Row/Column/Stack primitives — the spacing
 * scale minus `screenPadding`, which is a page-level constant, not a gap. */
export type SpacingKey = Exclude<keyof typeof spacing, 'screenPadding'>;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  /** Fully rounded — mode pills, AlertPill, circular buttons. */
  pill: 999,
} as const;

export const typography = {
  /**
   * Brand-board type pairing: Rajdhani (modern, bold, technical) for
   * headings, stats and labels; Inter (clean, high legibility) for body.
   * Requires both families to be loaded via useFonts at the app root.
   */
  fontFamily: {
    display: 'Rajdhani_700Bold',
    displayMedium: 'Rajdhani_600SemiBold',
    body: 'Inter_400Regular',
    bodyMedium: 'Inter_500Medium',
    bodySemibold: 'Inter_600SemiBold',
  },
  fontSize: {
    /** Uppercase letter-spaced section labels — "NEARBY ALERTS", "LIVE NEAR YOU". */
    eyebrow: 11,
    caption: 12,
    body: 15,
    bodyLarge: 17,
    /** Card titles, list-row titles. */
    title: 20,
    /** Screen-level headings. */
    heading: 28,
    /** Big glanceable numerals — ETA, speed, distance. */
    stat: 36,
  },
  letterSpacing: {
    eyebrow: 1.8,
    tight: 0.4,
    none: 0,
  },
} as const;
