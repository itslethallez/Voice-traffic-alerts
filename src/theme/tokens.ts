/**
 * Shotgun design-system tokens — the single source of truth for the UI.
 *
 * Stage 8 visual refresh (Nov 2026): values come from the "Shotgun
 * Redesign" mockup canvas ("dark, warm, on your side" — boards 1 Cruise
 * and 2 Live alert). Every pre-refresh key is kept (26 files import
 * these) but now resolves to the mockup's palette and type, so screens
 * not yet rebuilt pick up the new look without a rename. The legacy
 * `colors` / `instrument` / `hud` palettes in colors.ts stay untouched
 * and are not imported here.
 */

const palette = {
  /** Map ground / app background (mockup #10171A). */
  charcoal: '#10171A',
  /** Deepest ground — lock-screen / full-bleed night backdrop. */
  night: '#0B1214',
  /** Floating chrome: status pill, sheet, round buttons. */
  asphalt: '#1A2328',
  /** Hairlines, the sheet grabber, disabled tracks. */
  slate: '#3A474C',
  /** Brand — "Shotgun is watching" (status dot, you-are-here puck). */
  teal: '#00E5D6',
  /** Police — informational blue. Kept under its old name too. */
  coolBlue: '#6EA8FF',
  /** Cameras / caution — warm amber. */
  amber: '#FFB547',
  /** Critical alerts only (crash, closure-in-progress). */
  red: '#FF5A4F',
  /** Animal / roadkill hazards — their own green. */
  roadkill: '#3DDC97',
  /** Primary text / icons — a warm off-white, never pure #FFF on this ground. */
  white: '#F2F5F4',
} as const;

export const colors = {
  ...palette,
  /** Secondary copy — subtitles, meta ("Watching 4 km around you"). */
  textSecondary: '#A3B1B5',
  /** Copy on raised cards that must read stronger than secondary
   * ("Main North Rd · limit 60", the distance unit). */
  textTertiary: '#C9D3D6',
  /** The spoken-line quote inside the live alert card. */
  textQuote: '#E4EBED',
  /** Tertiary copy — map labels, timestamps, inactive labels. */
  textMuted: '#6F8288',
  // Semantic aliases — screens should prefer these over raw palette names.
  background: palette.charcoal,
  surface: palette.asphalt,
  /** Cards that sit on the map above chrome — the live alert card. */
  surfaceRaised: '#1E2A2F',
  /** Secondary buttons on `surface` ("Going somewhere?"). */
  surfaceControl: '#24313A',
  /** Insets inside a raised card (spoken-line quote, source chip). */
  surfaceInset: '#26343A',
  /** Progress tracks, secondary buttons on `surfaceRaised`. */
  surfaceTrack: '#33424A',
  border: 'rgba(163, 177, 181, 0.16)', // 1px hairlines on dark surfaces
  borderStrong: palette.slate,
  accent: palette.teal,
  /** Text/icons drawn ON the accent fill. */
  onAccent: '#062724',
  navigation: palette.coolBlue,
  police: palette.coolBlue,
  /** Glyph colour on a police-blue fill. */
  onPolice: '#0B1A33',
  /** Police icon tile on a dark surface. */
  policeTint: '#15223A',
  caution: palette.amber,
  camera: palette.amber,
  /** Glyph colour on an amber fill. */
  onCaution: '#3A2400',
  /** Camera icon tile on a dark surface. */
  cautionTint: '#3A2C12',
  /** Text on `cautionTint` (lock-screen "Next: speed camera"). */
  onCautionTint: '#F2E3C6',
  /** Dashed ring for a known (fixed) camera site that isn't live. */
  cameraSite: '#8A7240',
  critical: palette.red,
  textPrimary: palette.white,
  /** Dims the map behind a live alert card. */
  scrim: 'rgba(8, 12, 14, 0.45)',
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
  /** Active-route line + glow (§5) — a purer yellow, deliberately
   * separated from the amber/red congestion colouring that already
   * paints traffic on the map. Kept in map3d because it paints the map
   * canvas on both adapters. */
  routeLine: '#FFD940',
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
  /** Mockup's tight gap — status-pill gap to the mute button, list rows. */
  compact: 10,
  sm: 12,
  /** Icon-to-text gap inside the live alert card header. */
  cozy: 14,
  md: 16,
  /** Pill horizontal padding / card padding. */
  roomy: 20,
  lg: 24,
  xl: 32,
  xxl: 48,
  /** Standard outer padding applied by ScreenContainer on every screen —
   * the mockup's 16px side gutter. */
  screenPadding: 16,
} as const;

/** Gap steps accepted by the Row/Column/Stack primitives — the spacing
 * scale minus `screenPadding`, which is a page-level constant, not a gap. */
export type SpacingKey = Exclude<keyof typeof spacing, 'screenPadding'>;

export const radii = {
  sm: 8,
  /** Small icon tiles (36px list-row glyph tile). */
  md: 12,
  lg: 16,
  /** Large icon tile (56px live-alert glyph). */
  tile: 18,
  xl: 24,
  /** Bottom sheet top corners, the live alert card. */
  sheet: 28,
  /** Fully rounded — status pill, AlertPill, circular buttons. */
  pill: 999,
} as const;

/** Fixed control sizes from the mockup (all ≥ 44pt touch targets). */
export const sizes = {
  /** Status pill + round chrome buttons (mute). */
  chrome: 52,
  /** Primary/secondary buttons inside cards. */
  button: 48,
  /** Speed roundel. */
  roundel: 76,
  /** Live-alert glyph tile. */
  tileLg: 56,
  /** Sheet-row glyph tile. */
  tileSm: 36,
  /** Status dot in the Cruising pill. */
  statusDot: 10,
  /** Alert-card distance progress bar. */
  progressTrack: 8,
  grabberWidth: 40,
  grabberHeight: 5,
} as const;

/** Soft drop shadows from the mockup — chrome floats, the alert card floats higher. */
export const shadows = {
  chrome: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  sheet: {
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: -10 },
    elevation: 12,
  },
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 16 },
    elevation: 16,
  },
} as const;

export const typography = {
  /**
   * Plus Jakarta Sans throughout (mockup) — friendly, legible at a glance.
   * The old Rajdhani `display*` / Inter `body*` keys keep working and map
   * onto Jakarta weights. Loaded via useFonts in App.tsx.
   */
  fontFamily: {
    display: 'PlusJakartaSans_800ExtraBold',
    displayMedium: 'PlusJakartaSans_700Bold',
    body: 'PlusJakartaSans_400Regular',
    bodyMedium: 'PlusJakartaSans_500Medium',
    bodySemibold: 'PlusJakartaSans_600SemiBold',
    bodyBold: 'PlusJakartaSans_700Bold',
    heavy: 'PlusJakartaSans_800ExtraBold',
  },
  fontSize: {
    /** Roundel unit line ("km/h · 60"). */
    micro: 10,
    /** Uppercase letter-spaced section labels / map labels. */
    eyebrow: 11,
    caption: 12,
    /** Card meta ("On your route · 3 locals"). */
    meta: 13,
    /** List-row titles, card sublines, quotes. */
    label: 14,
    body: 15,
    lead: 16,
    bodyLarge: 17,
    /** Sheet heading ("Ahead of you"). */
    sheetTitle: 18,
    title: 20,
    /** Live alert headline ("Speed camera ahead"). */
    cardTitle: 22,
    /** Speed roundel numeral. */
    roundel: 24,
    /** Screen-level headings. */
    heading: 28,
    /** Big glanceable numerals — ETA, speed. */
    stat: 36,
    /** Live alert distance ("600"). */
    hero: 48,
  },
  letterSpacing: {
    eyebrow: 1.2,
    tight: 0.4,
    none: 0,
  },
} as const;
