# Handoff: Shotgun Radio — "HUD face" colour pass

Design reference: `Shotgun Radio - UI adjustment.dc.html`, option **2a** (option 1a is the
current build, recreated for comparison — don't implement it).

This is a **colour, rule-weight and header change only**. No layout, geometry, camera, data or
state changes. Every value below was measured at 390×844.

---

## 1. Tokens — `src/theme/colors.ts`

Add a new palette next to `instrument` (keep `instrument`; the HUD face replaces its *usage* on
the Radio screen, not the export):

```ts
export const hud = {
  ground: '#07090C',        // app ground (was instrument.ink #201E1D)
  statusBar: '#050709',     // status-bar strip
  ink: '#F5F7FA',           // primary text
  mapGround: '#0C1319',     // map field
  accent: '#2F9BE0',        // system state: LIVE, GPS, awareness, active tab, SPEED label
  accentBright: '#4FB0EE',  // "ONE TAP" caption on the report block
  accentInk: '#DDEAF3',     // "LIVE" wordmark
  muted: '#79838B',         // meta line, inactive tab labels
  mutedLabel: '#6E7A85',    // ledger header label
  rule: 'rgba(150,190,215,0.30)',    // 1px section rules (replaces the 2px paper rules)
  ruleStrong: 'rgba(150,190,215,0.45)', // report block's left border
  rowRule: 'rgba(150,190,215,0.16)', // 1px rule between ledger rows
  // Severity, applied to the ledger row rail + confidence tail + distance:
  sevHigh: '#E01B24',       // rail, police / nearest
  sevHighText: '#F0453A',   // distance numeral, unit, confidence tail
  sevMed: '#E8930C',        // rail + text, second tier (and the header motto)
  rowTitle: '#FFFFFF',
  rowSubHigh: '#D3DAE0',
  rowSubMed: '#9AA4AC',
} as const;
```

**Rule weights.** The redesign's "only 2px" rule is dropped on this screen: every section divider
(header bottom, map bottom, ledger top, speed row top, tab bar top, tab cell left borders) becomes
**1px `hud.rule`**. Ledger row rules stay 1px, now `hud.rowRule`. The active tab's top marker goes
**5px → 2px `hud.accent`** with `marginTop: -1`.

---

## 2. `src/screens/DriveScreen.tsx`

**Header** (`styles.header`)
- `paddingTop: 16 → 6`, `borderBottomWidth: 2 → 1`, colour `instrument.paper → hud.rule`.
- `liveDot.backgroundColor` → `hud.accent`; `liveText.color` → `hud.accentInk`.
- **New motto line** between the brand row and the meta line:
  `EVERYTHING IS IN SIGHT`, `marginTop: 5`, Archivo 700, `fontSize: 11`, `letterSpacing: 2.5`,
  colour `hud.sevMed`. Static string — no state.
- Meta line: `marginTop: 6 → 8`, base colour `hud.muted`, and it is now **three `Text` spans**, not
  one string: the awareness value (`8.8 KM`) and the GPS clause (`GPS LOCKED` / `ACQUIRING GPS`)
  render in `hud.accent`, the rest in `hud.muted`. Same `statusFor()` / `announceDistanceMeters` /
  `driverPosition` sources as today — split the existing `metaLine` template into parts rather than
  colouring the whole line.

**Ledger header row** — `NEARBY ALERTS` → `hud.mutedLabel`; the count (`2 ALERTS`) → `hud.accent`.
`ledgerRule.borderTopWidth: 2 → 1`, colour `hud.rule`.

**Ledger rows** — the paper inversion of the nearest row is **removed**. Every row is on ground,
distinguished by a severity rail instead:

- `borderLeftWidth: 6`, colour `hud.sevHigh` for the nearest/police row, `hud.sevMed` otherwise.
- Row tint, left-to-right fade over the rail colour (`expo-linear-gradient`, horizontal):
  high `rgba(224,27,36,0.20) → 0.03 at 62% → 0`; medium `rgba(232,147,12,0.12) → 0.02 at 58% → 0`.
- `gap: 14 → 8`; `paddingRight: 20 → 14` (left stays 20). Title/subtitle column stays
  `flex: 1, minWidth: 0`; add `numberOfLines={1}` to both.
- Title: `fontSize 19 → 17`, `letterSpacing 0.5 → 0`, colour `hud.rowTitle`.
- Subtitle: `letterSpacing 0.5 → 0`, colour `hud.rowSubHigh` (high) / `hud.rowSubMed` (medium);
  the confidence tail after the `·` is a nested `Text` in `hud.sevHighText` / `hud.sevMed`. Split
  `subtitle` into `place` + `detail` and render two spans instead of one joined string.
- Distance: value + unit wrap in **one right-aligned block**, `flex: none`, `minWidth: 44`,
  `gap: 4`, `alignItems: 'baseline'`. Value 24/900 tabular, unit 11/700/ls 1 — both
  `hud.sevHighText` / `hud.sevMed`.
- Police light bar on a row: `orientation="horizontal"`, **30 × 13**, `alignSelf: 'center'`
  (was vertical 26 × 26, `inverted`). Police only, as today.

These three constraint numbers (`gap 8`, `paddingRight 14`, `minWidth 44`) are what let
`WITH MOBILE CAMERA POLICE` sit on one line — don't raise them.

---

## 3. `src/screens/radar/PoliceLightBar.tsx`

- Add a **2px gap between the two cells** (`gap: 2` on the bar) so it reads as a two-lamp light bar.
- Add a **glow on the lit cell**: `shadowColor` = that cell's lit colour, `shadowOpacity: 0.85`,
  `shadowRadius: 6`, `elevation: 6`, animated in antiphase with the colour (lit = glow on,
  off = `shadowOpacity: 0`). Timing unchanged: 460ms hard-cut phases, 920ms cycle.
- `inverted` is now unused on the Radio screen (no inverted rows) — keep the prop for History.

---

## 4. `src/screens/radar/Speedometer.tsx`

- Cell background: vertical gradient `#0A1E30 → #060D16` (`expo-linear-gradient`).
- `caption` colour → `hud.accent`; `unit` (`KM/H`) → `hud.accent`; numeral stays `hud.ink`.
- Sizes, letter-spacing, tabular figures, padding: unchanged.

## 5. `src/screens/radar/ReportButton.tsx`

- No longer inverted at rest: background becomes a vertical gradient `#14395C → #0A2338`,
  `borderLeftWidth: 2 → 1` in `hud.ruleStrong`.
- `caption` (`ONE TAP`) → `hud.accentBright`, drop the `opacity: 0.7`; `label` → `hud.rowTitle`.
- Pressed state inverts to `hud.accent` ground with `hud.ground` text (was ink/paper).
- Width 150, padding, `REPORTED` confirmation, `pushManualReport()`: unchanged.

## 6. `src/navigation/BottomNav.tsx`

- `root.borderTopWidth: 2 → 1` `hud.rule`; `tabDivider` `2 → 1` `hud.rule`.
- Inactive label → `hud.muted`. Active: colour `hud.accent`, `borderTopWidth: 5 → 2`
  `hud.accent`, `marginTop: -1`, plus a vertical gradient
  `rgba(47,155,224,0.16) → transparent` behind the cell and a 44 × 2 `hud.accent` glow bar centred
  16 above the bottom edge (`shadowRadius: 2` / `blur` equivalent).

## 7. `src/screens/radar/RadarMap.tsx`

- `mapGround` fallback → `hud.mapGround`; `borderBottom` 2px paper → 1px `hud.rule`.
- Radar rings: **three** rings instead of two — 236, 178, 120 — all `borderWidth: 1`
  `hud.accent`, same 1s pulse (`scale 1 → 1.08`, `opacity .5 → .15`).
- `DriverMark`: keep the white triangle, add a glow — `shadowColor: hud.accent`,
  `shadowRadius: 12`, `shadowOpacity: 0.9`.
- Heading chip: ground `hud.ground`, `padding: 5 8` (was 3 6), text unchanged.
- Camera, dwell gate, focus transition, marker logic, Mapbox `StyleURL.Dark`: **unchanged**.

## 8. `App.tsx`

- `root` / `loading` background `instrument.ink → hud.ground`. `StatusBar style="light"` unchanged.

---

## Not covered here

History and Settings still run the mono instrument face. Say the word and I'll extend the same
colour logic to both (severity rails on History rows, `hud.accent` for Settings' on-state blocks)
and add it to this document.
