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

/**
 * "HUD face" colour pass (design reference: `Shotgun Radio - UI adjustment.dc.html`,
 * option 2a) - a colour, rule-weight and header change layered onto the Radio
 * screen specifically. Keeps `instrument` intact for History/Settings, which
 * still run the mono face untouched.
 */
export const hud = {
  ground: '#07090C', // app ground (was instrument.ink #201E1D)
  statusBar: '#050709', // status-bar strip
  ink: '#F5F7FA', // primary text
  mapGround: '#0C1319', // map field
  accent: '#2F9BE0', // system state: LIVE, GPS, awareness, active tab, SPEED label
  accentBright: '#4FB0EE', // "ONE TAP" caption on the report block
  accentInk: '#DDEAF3', // "LIVE" wordmark
  muted: '#79838B', // meta line, inactive tab labels
  mutedLabel: '#6E7A85', // ledger header label
  rule: 'rgba(150,190,215,0.30)', // 1px section rules (replaces the 2px paper rules)
  ruleStrong: 'rgba(150,190,215,0.45)', // report block's left border
  rowRule: 'rgba(150,190,215,0.16)', // 1px rule between ledger rows
  // Severity, applied to the ledger row rail + confidence tail + distance:
  sevHigh: '#E01B24', // rail, police / nearest
  sevHighText: '#F0453A', // distance numeral, unit, confidence tail
  sevMed: '#E8930C', // rail + text, second tier (and the header motto)
  rowTitle: '#FFFFFF',
  rowSubHigh: '#D3DAE0',
  rowSubMed: '#9AA4AC',
} as const;
