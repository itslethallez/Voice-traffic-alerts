export const colors = {
  background: '#0A0A0C',
  backgroundAccent: '#12121C',
  ink: '#F5F5F7',
  inkMuted: 'rgba(245, 245, 247, 0.6)',
  inkFaint: 'rgba(245, 245, 247, 0.35)',
  accent: '#6C8CFF',
  accentDim: '#3A4A8C',
  warning: '#E8B04B',
  muteButtonIdle: '#1C1C24',
  muteButtonActive: '#2A2A38',
  /** The Report-dial's lime accent (Step 11b) - deliberately far from
   * `accent`'s blue (driver/police) and `warning`'s amber (hazards/jams)
   * so the one control the driver actively presses reads as visually
   * distinct from anything the app itself is reporting. */
  report: '#C6FF3D',
  reportDim: 'rgba(198, 255, 61, 0.18)',
  /** Police radar marker's flashing lights (Step 12 #24) - deliberately
   * saturated, unlike the muted `accent` blue used for the marker's static
   * meta color, so the flash reads as an emergency-light effect. */
  policeLightBlue: '#3D6BFF',
  policeLightRed: '#FF3D3D',
} as const;

/**
 * The "Instrument" redesign's palette (design_handoff_instrument_face) -
 * a flat ruled instrument face with no accent colour at all; emphasis is a
 * full ink/paper inversion instead. Kept separate from `colors` above
 * until every screen has migrated - see the handoff README for the full
 * rationale and measured values.
 */
export const instrument = {
  ink: '#201E1D', // night ground, day ink
  paper: '#F3F2F2', // day ground, night ink
  statusBar: '#141312', // status-bar strip, night face only
  mapGround: '#14140F', // map field, night
  mapRoad: '#2B2927', // road fills, night
  mapGroundDay: '#E4E2E1',
  // Night-face secondary text / rules, over `ink`:
  mutedOnInk: 'rgba(243,242,242,0.55)',
  ruleOnInk: 'rgba(243,242,242,0.20)', // 1px row rules
  faintOnInk: 'rgba(243,242,242,0.30)', // slider track
  tickOnInk: 'rgba(243,242,242,0.40)', // slider end labels
  gridOnInk: 'rgba(243,242,242,0.07)', // map grid
  // Day-face equivalents, over `paper`:
  mutedOnPaper: '#6B6764',
  ruleOnPaper: 'rgba(32,30,29,0.20)',
  gridOnPaper: 'rgba(32,30,29,0.07)',
} as const;
