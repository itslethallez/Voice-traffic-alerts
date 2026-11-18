# Handoff: Shotgun — "Instrument" UI

## Overview
A complete visual redesign of the Voice Traffic Alerts (Shotgun) app: Radio (Drive), History and
Settings. The shipped UI is a dark, rounded, card-and-pill layout with emoji icons. This redesign
replaces it with a ruled instrument face: flat surfaces, zero corner radius, 2px rules, flush-left
typography, values set right in tabular figures, and **no accent colour at all** — emphasis is a
full ink/paper inversion. The only colour in the product is the blue/red police light bar, which
now means exactly one thing: police.

Same typeface as today (`Archivo`, already loaded via `@expo-google-fonts/archivo`), so no new
font dependency.

## About the Design Files
`Voice Traffic Alerts - Current UI.dc.html` is a **design reference created in HTML** — a prototype
showing intended look and behaviour, not production code to copy. The task is to **recreate these
designs in the existing Expo / React Native codebase** using its established patterns
(`StyleSheet.create`, the `src/theme/*` token modules, the existing Zustand stores). Do not port the
HTML or its CSS.

Open the file in a browser. It contains three stacked turns, newest first:

| Turn | Contains |
| --- | --- |
| Turn 3 (top) | `3a` History — night face, `3b` Settings — night face |
| Turn 2 | `2a` Radio — day face, `2b` Radio — night face |
| Turn 1 (bottom) | Pixel recreation of the **current** shipped UI, for before/after comparison |

**Implement the night face** (`2b`, `3a`, `3b`). The day face (`2a`) is an alternative light-ground
treatment of the same layout, kept for reference and as the basis of a future light mode.

## Fidelity
**High-fidelity.** Colours, type sizes, weights, letter-spacing, rule weights and paddings below are
final and were measured from the prototype at 390×844 (iPhone 14/15 logical size). Recreate
pixel-for-pixel. Every value has an exact number below; where a shipped value is unchanged, that is
called out.

---

## Design Tokens

Add these to `src/theme/colors.ts` as a new palette (keep the old one until migration is complete —
`policeLightBlue` / `policeLightRed` already exist and are reused unchanged).

```ts
export const instrument = {
  ink: '#201E1D',        // night ground, day ink
  paper: '#F3F2F2',      // day ground, night ink
  statusBar: '#141312',  // status-bar strip, night face only
  mapGround: '#14140F',  // map field, night
  mapRoad: '#2B2927',    // road fills, night
  mapGroundDay: '#E4E2E1',
  // Night-face secondary text / rules, over `ink`:
  mutedOnInk: 'rgba(243,242,242,0.55)',
  ruleOnInk: 'rgba(243,242,242,0.20)',   // 1px row rules
  faintOnInk: 'rgba(243,242,242,0.30)',  // slider track
  tickOnInk: 'rgba(243,242,242,0.40)',   // slider end labels
  gridOnInk: 'rgba(243,242,242,0.07)',   // map grid
  // Day-face equivalents, over `paper`:
  mutedOnPaper: '#6B6764',
  ruleOnPaper: 'rgba(32,30,29,0.20)',
  gridOnPaper: 'rgba(32,30,29,0.07)',
} as const;
```

There is **no accent colour**. Anywhere the shipped app used `colors.accent` (#6C8CFF) or
`colors.report` (#C6FF3D) for emphasis, the redesign inverts ground and ink instead.

Police light bar (existing values, unchanged):
- `policeLightBlue` `#3D6BFF`
- `policeLightRed` `#FF3D3D`

**Rules (borders).** Only two weights exist:
- **2px** solid, full-contrast (`paper` on night, `ink` on day) — between major sections.
- **1px** solid `ruleOnInk` / `ruleOnPaper` — between rows inside a ledger.
- The active tab marker is a **5px** solid bar in `currentColor` on the tab's top edge, pulled up
  `-2px` so it sits over the nav's 2px rule.

**Radius.** `0` everywhere. No exceptions, including buttons, markers and toggles. The awareness
rings on the map are true circles (`borderRadius: 9999`), which is geometry, not decoration.

**Shadow.** None inside the app frames.

**Type.** Archivo only. Sizes in use:

| Role | Size | Weight | Letter-spacing |
| --- | --- | --- | --- |
| Screen title (`HISTORY`, `SETTINGS`) | 34 | 900 | -0.5 |
| Brand (`SHOTGUN`) | 22 | 900 | 3 |
| Speedometer numeral | 76 | 900 | -3 |
| Big value (volume/rate) | 30 | 900 | 0 |
| Ledger distance / count | 24–26 | 900 | 0 |
| Ledger row title | 18–19 | 900 | 0.5 |
| Settings row label | 16–17 | 700 | 0.5 |
| Report block label | 20 | 900 | 0.5 |
| Section label / caps meta | 11–12 | 700 | 1.5–2 |
| Row subtitle | 12 | 500 | 0.5 |
| Marker distance chip | 10 | 700 | 0.5 |

All numeric readouts (speed, distances, times, volume, rate, alert counts) use
`fontVariantNumeric: 'tabular-nums'` — in React Native use `fontVariant: ['tabular-nums']` so
digits don't jitter as values tick.

All caps strings in the design are **authored** as caps in the prototype. In the app, prefer
`textTransform: 'uppercase'` over uppercasing the data, so the underlying values
(`alertTypeMeta.label`, street names from `announcementLocation`) stay as-is.

**Spacing.** Horizontal page padding is `20`. Vertical row padding: 12–13 for ledger rows,
8–9 for the denser Settings rows. Section label rows: `10` top / `8` bottom.

---

## Screens / Views

### 1. Radio (Drive) — `2b` in the prototype
Replaces `src/screens/DriveScreen.tsx` + everything under `src/screens/radar/`.

**Purpose:** hands-free awareness. The driver should learn the nearest threat, its distance and
their own speed in one glance, and be able to report police with one tap.

**Layout** (top to bottom, single column, `flex: 1`, ground `ink`):
1. **Status-bar strip** — height 47, `statusBar` (#141312). `SafeAreaView` handles this on device;
   the fill exists so the notch area doesn't read as part of the header.
2. **Header** — `padding: 16 20 12`, `borderBottomWidth: 2` `paper`.
   - Row 1: `SHOTGUN` 22/900/ls 3, flush left. Right: a 9×9 square in `currentColor`, then
     `LIVE` 12/700/ls 1.5. Both inherit the ground's ink colour (no accent).
   - Row 2, `marginTop: 6`: `LISTENING · 5 KM AWARENESS · GPS LOCKED` 12/500/ls 1.5 `mutedOnInk`.
     This one line replaces the shipped status dot + GPS pill + banner slot. Compose it from
     `statusFor()`, `announceDistanceMeters` and `driverPosition` — same sources as today. If
     `locationError` is set, replace the whole line with the error text (still 12/500/ls 1.5).
     If `bannerMessage` is set, render it as a second line in full-contrast ink, not a tinted pill.
3. **Map** — height 268, `flex: none`, `borderBottomWidth: 2` `paper`, **full-bleed** (no horizontal
   margin, no radius — the map meets the frame edges). Ground `mapGround`.
   - Mapbox config is unchanged from `RadarMap.tsx`; switch `styleURL` to a **monochrome** dark
     style so the tiles match (no coloured roads). Keep `scrollEnabled/zoomEnabled/pitchEnabled/
     rotateEnabled` all false and the existing camera logic (`zoomForRingRadius`, the dwell gate,
     the focus transition) exactly as-is — none of that changes.
   - **Awareness rings**, centred, non-interactive: 236×236 and 120×120 circles,
     `borderWidth: 1`, `rgba(243,242,242,0.35)` and `rgba(243,242,242,0.20)`. The 236 ring is the
     awareness radius (the existing `AWARENESS_RING_SIZE` maths applies — adjust the constant to
     236 and let `zoomForRingRadius` do the rest). The old ring **label pill and radius badge are
     both deleted** — the radius is stated once, in the header line.
   - **Driver mark** replaces `PulseRings`: a solid triangle pointing up, 22 wide × 26 tall, in
     `paper`. No disc, no pulsing rings. (In RN, an equilateral triangle via borders as today, or a
     small `Svg` polygon.)
   - **Alert markers** replace the emoji pins, 34×34, square, ground `ink`:
     - A single letter, 15/900, centred: `P` police, `H` hazard, `X` crash, `C` road closed,
       `J` jam. Derive from a new `letter` field on `alertTypeMeta` — do not reuse `emoji`.
     - Non-police markers: `borderWidth: 2` `paper`, letter in `paper`.
     - **Police marker** carries the light bar: the top 9px of the square is split into two equal
       cells, left flashing blue, right flashing red (see Interactions). The letter sits in the
       remaining 25px.
     - Distance chip below the marker, `marginTop: 3`, `padding: 1 4`, ground `ink`,
       text 10/700/ls 0.5 `paper` — format `1.2 KM` (i.e. `formatCompactDistance` with a space and
       caps unit).
   - **Heading label**, absolute `top: 12 left: 20`: `NORTHBOUND · ANZAC HWY` 11/700/ls 1.5 on an
     `ink` chip, `padding: 3 6`. Source: `compassDirection(driverHeadingDeg)` + the current
     street from the newest announcement's `announcementLocation`.
4. **Alert ledger** — `flex: 1`.
   - Header row: `padding: 12 20 8`, left `AHEAD OF YOU`, right `3 ALERTS` (the count), both
     11/700/ls 2 `mutedOnInk`. Then `borderTopWidth: 2` `paper`.
   - One row per nearby alert, `padding: 12 20`, `borderBottomWidth: 1` `ruleOnInk`,
     `flexDirection: 'row'`, `alignItems: 'center'`, `gap: 14`:
     - Title 19/900/ls 0.5 caps (`POLICE`, `HAZARD`, `CRASH`).
     - Subtitle 12/500/ls 0.5 `mutedOnInk`: `STREET · CONFIDENCE` from `announcementLocation` +
       `confidenceLabel`; for stale items use `STREET · 11 MIN AGO` instead.
     - Distance, set right: number 24/900 tabular, then unit `KM` 11/700/ls 1 `mutedOnInk`.
       Split the value from the unit so the numerals align down the column.
     - **The nearest row is inverted**: ground `paper`, text `ink`, and it leads with a 26×26
       vertical two-cell light bar when the alert is police. This inversion replaces the shipped
       "Nearby transmission" card entirely — the waveform, play button, avatar and
       `NEARBY TRANSMISSION` label are all deleted. (Keep `speakAsync` replay if you want it: make
       the inverted row itself the tap target.)
   - Show up to 3; the list is the existing `selectNearbyAlerts` output (raise its cap from 2 to 3).
5. **Speed + report** — one row, `borderTopWidth: 2` `paper`, `flex: none`:
   - Left cell `flex: 1`, `padding: 10 20 14`: label `SPEED` 11/700/ls 2 `mutedOnInk`, then the
     numeral 76/900/ls -3, `lineHeight: 0.95`, tabular, with `KM/H` 14/700/ls 1.5 `mutedOnInk` on
     the baseline.
   - Right cell width **150**, `flex: none`, `borderLeftWidth: 2` `paper`, ground `paper`, text
     `ink`, `padding: 12 16`, content bottom-aligned: `ONE TAP` 11/700/ls 1.5 at 0.7 opacity, then
     `REPORT` / `POLICE` on two lines, 20/900/ls 0.5, `lineHeight: 1.05`. This is the whole
     `ReportButton` — full-height, flush-left label, no icon. Height ≥ 44 is satisfied comfortably
     (the cell is ~100 tall).
   - On press, keep the existing `pushManualReport()` + 1500ms confirmation. Confirmation state:
     swap the label to `REPORTED` and hold the inversion (no tick emoji).
6. **Tab bar** — `borderTopWidth: 2` `paper`, three equal cells, `padding: 14 0 22`,
   `textAlign: 'center'`, labels `RADIO` / `HISTORY` / `SETTINGS` 12/ls 1.5. Inactive 700
   `mutedOnInk`; active 900 in full ink with a `borderTopWidth: 5` `currentColor` bar and
   `marginTop: -2`. Cells 2 and 3 have `borderLeftWidth: 2` `paper`. **No icons** — the emoji
   glyphs (`⏺ ⚡ ⚙`) are removed and not replaced.

### 2. History — `3a`
Replaces `src/screens/HistoryScreen.tsx`.

**Purpose:** what was said to me, and what I reported, this trip.

- **Header**: `padding: 16 20 12`, `borderBottomWidth: 2` `paper`. `HISTORY` 34/900/ls -0.5 flush
  left; total row count right, 24/900 tabular. Second line `THIS TRIP · 41 MIN · 34 KM`
  12/500/ls 1.5 `mutedOnInk` (derive from trip start time and distance travelled; if you don't
  track distance yet, ship `THIS TRIP · 41 MIN` and add the km later).
- **Two labelled groups**, replacing the flat merged list. Group label rows: `padding: 10 20 8`,
  11/700/ls 2 `mutedOnInk`, with a 2px `paper` rule above and below.
  - `SPOKEN TO YOU` — the `recentAnnouncements` rows.
  - `YOUR REPORTS` — the `manualReports` rows.
  Sort within each group newest first (the existing merge-then-sort becomes two sorts).
- **Row**: `padding: 13 20`, `borderBottomWidth: 1` `ruleOnInk`, `flexDirection: 'row'`,
  `alignItems: 'flex-start'`, `gap: 14`:
  - Leading 22×22 mark: bordered square with the type letter for announcements; the vertical
    two-cell light bar for police (spoken or reported).
  - Title 18/900/ls 0.5 caps — the type, or `POLICE REPORTED` for a manual report.
  - Subtitle 12/500/ls 0.5 `mutedOnInk` — the structured pieces, not the spoken sentence:
    `ANZAC HWY, GLANDORE · NORTHBOUND · 1.2 KM AHEAD`. Build it from `announcementLocation` +
    `formatDistance`, not from `announcement.text`. For manual reports:
    `NORTHBOUND · LOCATION ATTACHED`.
  - Time set right, 12/700/ls 1 tabular, `paddingTop: 3` — `NOW` / `6M` / `12M`
    (`formatRelativeTime` uppercased and stripped of "ago").
  - **The newest row in a group is inverted** (`paper` ground, `ink` text) — same device as the
    Radio ledger. Subtitle on an inverted row is the same 12/500 at 0.7 opacity.
- **Empty state**: keep the copy (`Nothing announced or reported yet this trip.`) but set it
  16/500 flush left at `padding: 20`, not centred.
- Tab bar as above, `HISTORY` active.

### 3. Settings — `3b`
Replaces `src/screens/SettingsScreen.tsx`. **No cards, no `Switch`, no `Slider` thumbtracks.**

- **Header**: `padding: 16 20 12`, `borderBottomWidth: 2` `paper`, `SETTINGS` 34/900/ls -0.5,
  `DONE` 12/700/ls 1.5 right (still calls `onClose`).
- **Section label rows** (`SPEAK THESE`, `RANGE`, `VOICE`): `padding: 10 20 8`, 11/700/ls 2
  `mutedOnInk`, 2px `paper` rules above and below.
- **Category rows** — one per `ALERT_CATEGORIES` entry, `padding: 9 20`,
  `borderBottomWidth: 1` `ruleOnInk`:
  - Label 16–17/700/ls 0.5. When off, label drops to `mutedOnInk`.
  - State block right, `padding: 4 10`, 11/900/ls 1.5: **on** = ground `paper`, text `ink`, no
    border; **off** = transparent ground, `borderWidth: 2` `mutedOnInk`, text `mutedOnInk`.
    The whole row is the toggle target (`Pressable`, `accessibilityRole: 'switch'`,
    `accessibilityState: { checked }`) — keep `toggleCategory`.
- **Range rows** (announce distance, briefing radius) — `padding: 10 20 8`,
  `borderBottomWidth: 1` `ruleOnInk`:
  - Label 17/700/ls 0.5 left; value 26/900 tabular + unit `KM` 11/700/ls 1 `mutedOnInk` right.
  - Track, `marginTop: 12`, height 18: a 2px full-width line in `faintOnInk`, a 2px filled line
    from the left to the current fraction in `paper`, and a **6×18 square thumb** in `paper`
    centred on that fraction. Keep `@react-native-community/slider` for the gesture if you like,
    but restyle it — or drive it with a `PanResponder` over this geometry. Steps unchanged
    (100m / 500m), bounds unchanged.
  - End labels below, 10/700/ls 1 `tickOnInk`, min left / max right (`0.5` … `20 KM`).
- **Voice** — one row split into two equal cells by a 2px `paper` `borderLeft`, `padding: 8 20 10`
  each: caption (`VOLUME` / `RATE`) 11/700/ls 1.5 `mutedOnInk`, then the value 30/900 tabular with
  its unit (`%` / `×`) 12/700 on the baseline. Tapping a cell opens the same stepper/slider you use
  for Range; the shipped inline sliders are gone.
- **Mute everything** row: `padding: 8 20`, label 17/700/ls 0.5, state block as the categories.
  Still bound to `toggleMasterMute` in `useSettingsStore` — the Radio screen no longer has its own
  mute button, so this is the only control (see Open questions).
- **Build section**: `BuildInfoCard` keeps all its rows and behaviour; restyle to the same ledger
  (label left 15/400 `mutedOnInk`, value right 13/500 `paper`, 1px `ruleOnInk` between rows) and
  make the button a full-width inverted block: ground `paper`, text `ink`, 15/900/ls 1, height 44,
  radius 0. It sits below `MUTE EVERYTHING` in the scroll.
- Tab bar as above, `SETTINGS` active.

---

## Interactions & Behaviour

**Police light bar** — the one animation in the redesign, and the only colour.
- Two cells (side-by-side on map markers, stacked on ledger rows), each half the bar.
- Period **920ms**: each cell holds its lit colour for 460ms, then its off state for 460ms, in
  antiphase — blue lit while red is off, then swap. Hard cut, no crossfade.
- Off state: on a dark ground, the cell's colour at **18% alpha** (`rgba(61,107,255,0.18)` /
  `rgba(255,61,61,0.18)`). On an **inverted (paper) row**, the off state is solid `ink` — the alpha
  version reads as pale pink/blue on paper.
- In RN this is `PoliceLightsPin.tsx`'s existing pattern: `withRepeat(withTiming(1, { duration: 460,
  easing: Easing.steps(1, true) }), -1, true)` driving two `interpolateColor`s. Reuse that hook,
  render two cells instead of a bordered circle.
- Reserved for police only — never used for hazard, crash, closure or jam.

**Everything else is static.** The shipped `PulseRings` sweep is deleted; the transmission
waveform is deleted. Rationale: motion in the periphery of a driving UI should mean something, and
now exactly one thing moves.

**Camera behaviour is unchanged.** Keep `RadarMap.tsx`'s spotlight, dwell gate
(`MIN_ALERT_DWELL_MS`), zoom-out-then-in focus transition and all its constants. When an alert is
focused, hide the awareness rings and the heading chip (as today) — the inverted ledger row already
shows which alert has focus, so no extra treatment is needed.

**Press states.** Every `Pressable` inverts on press: a row on `ink` flips to `paper`/`ink` for the
duration of the press; an already-inverted block drops to `ink`/`paper`. No opacity fades, no
ripple. Use `Pressable`'s `style={({pressed}) => …}`.

**Focus / accessibility.** Keep every existing `accessibilityRole` / `accessibilityLabel`. The
letter markers need labels (`accessibilityLabel="Police alert, 1.2 kilometres"`) since a bare `P`
is meaningless to a screen reader. Contrast: `paper` on `ink` is ~14:1; `mutedOnInk` (55%) on `ink`
is ~5.5:1 — fine for the 11–12px caps meta at 700 weight, but do not drop below 55%.

**Minimum sizes.** `MIN_GLANCEABLE_FONT_SIZE = 24` is now genuinely honoured for primary Drive
content: the speed numeral (76) and the ledger distances (24) are the two things read while
moving. Row titles at 19 and meta at 11–12 are secondary-glance / stationary content — if you want
to enforce the 24 floor literally, the ledger row title is the one to raise.

## State Management
No new state. The redesign reads exactly what exists today:
- `useTripStore`: `driverPosition`, `driverHeadingDeg`, `driverSpeedKmh`, `visibleAlerts`,
  `recentAnnouncements`, `manualReports`, `isOffline`, `bannerMessage`, `locationError`.
- `useSettingsStore`: `categoriesEnabled`, `announceDistanceMeters`, `briefingRadiusMeters`,
  `voiceVolume`, `voiceRate`, `masterMute`.
- `statusFor()` / `statusLabel()` now feed the header's single meta line instead of a dot + pill.
- `selectNearbyAlerts` cap goes 2 → 3.
- `alertTypeMeta` gains `letter` (`P`/`H`/`X`/`C`/`J`) and loses nothing; `emoji` and `color`
  become unused once all screens are migrated.
- `useAnnouncementSlideIndex` in `DriveScreen.tsx` is **deleted** — the 2s slideshow of recent
  announcements goes away with the transmission card. The ledger shows what's ahead, not what was
  last said.

## Assets
- `assets/brand-badge.png` — **no longer used**. The header is the wordmark set in Archivo 900.
  The app icon assets are untouched.
- No icons, no images, no SVG in the redesign. Type and rules only.
- Fonts: `Archivo_400Regular` / `500Medium` / `700Bold` / `900Black` — already loaded in `App.tsx`.
  900 and 700 carry most of the design; 400 is now barely used.

## Files
- `Voice Traffic Alerts - Current UI.dc.html` — the design reference (all three turns).
- `support.js` — the runtime that renders that file; keep it beside the HTML so it opens.

Source files this design replaces:
`App.tsx` · `src/navigation/BottomNav.tsx` · `src/screens/DriveScreen.tsx` ·
`src/screens/HistoryScreen.tsx` · `src/screens/SettingsScreen.tsx` · `src/screens/BuildInfoCard.tsx` ·
`src/screens/radar/*` (all) · `src/theme/colors.ts` · `src/theme/alertTypeMeta.ts`

Untouched: everything under `src/api`, `src/engine`, `src/geo`, `src/speech`, `src/store`,
`src/trip`, `src/location`, `src/background`. This is a presentation-layer change only.

## Open questions for the team
1. **Master mute** now lives only in Settings — the Radio header's 🔊 button is gone. If one-tap
   mute matters while driving, the `LIVE` block in the header is the natural place to make tappable
   (`LIVE` → `MUTED`, inverted).
2. **Light mode.** `2a` is a complete day face of the Radio screen. Worth wiring to
   `useColorScheme()` if you want it, but the night face should be the default for a driving app.
3. **Trip distance** on the History header (`34 KM`) isn't tracked today.
