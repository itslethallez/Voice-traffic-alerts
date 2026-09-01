# Build prompt — Shotgun Radio, HUD face

Paste this into an implementation session (Claude Code or similar) alongside the
repo and the standalone UI file. Every value below is what's drawn in
`Voice Traffic Alerts - Current UI (standalone).html`; the design doc is the
source of truth for anything not spelled out here.

---

## The ask

Rebuild the Radio (drive) screen of the Voice Traffic Alerts app on the "HUD
face" colour pass, add a three-way manual report bar, and add a focus panel that
details the closest report when the car is heading toward it.

Reference frames in the design doc, newest turn first:

| id | What it shows |
| --- | --- |
| `6a` | Focus panel — closest report, heading toward it |
| `6b` | Same, heading away — panel stands down |
| `5a` | Three-way report bar (police / accident / hazard) |
| `4a` | The HUD colour pass at rest, single report block |
| `2a`–`3b` | The earlier mono "instrument" face, for contrast |

Build `6a` / `6b` as the shipping Radio screen. `4a` and `5a` are the
intermediate steps and exist to show where the values came from.

---

## Colour and type

Ground and rules:

| Role | Value |
| --- | --- |
| Screen ground | `#07090C` |
| Status-bar ground | `#050709` |
| Map ground | `#0C1319` |
| Map road fill | `#16222B` |
| Section rule | `1px solid rgba(150,190,215,0.30)` |
| Row rule | `1px solid rgba(150,190,215,0.16)` |
| Map grid | `rgba(150,190,215,0.07)`, 64px pitch, both axes |

Text and accent:

| Role | Value |
| --- | --- |
| Primary text | `#F5F7FA` / `#FFFFFF` for row titles |
| Secondary text | `#D3DAE0` |
| Tertiary / dim | `#9AA4AC`, `#79838B`, `#6E7A85` |
| Blue accent (system state) | `#2F9BE0`, light step `#4FB0EE` |
| Amber (medium severity, motto) | `#E8930C` |
| Red (high severity) | rail `#E01B24`, numerals/text `#F0453A` |

Type is Archivo throughout. Weights are 900 for numerals and titles, 700 for
labels, 500 for supporting copy. Every label is uppercase with letter-spacing
1–3px. Distance numerals use `font-variant-numeric: tabular-nums` so they don't
jitter as they count down.

The blue accent carries **system state only** — LIVE dot, GPS lock, awareness
radius, radar rings, SPEED label, active tab. Severity is carried by red and
amber alone. Do not use blue for an alert and do not use red for a system state.

---

## Screen structure, top to bottom (390 × 844)

1. **Status bar** — 47px, `#050709`, empty.
2. **Header** — `SHOTGUN` at 22px/900, letter-spacing 3px; right-aligned 9px
   blue square with `box-shadow: 0 0 8px 1px rgba(47,155,224,0.7)` and the label
   `LIVE`. Below it the motto `EVERYTHING IS IN SIGHT` in amber at 11px/700,
   letter-spacing 2.5px. Below that the status line
   `LISTENING · 8.8 KM AWARENESS · GPS LOCKED`, dim with the two data values in
   blue. Bottom section rule.
3. **Map** — 268px tall, `overflow: hidden`, position relative.
   - Grid, three road bars (two rotated `-9deg` / `5deg`, one vertical at 46%).
   - Three radar rings centred on the driver mark at 236 / 178 / 120px, `1px
     solid #2F9BE0`, each running `hudRing` (scale 1 → 1.08, opacity 0.5 → 0.15)
     for 1s `ease-out infinite alternate` with delays 0 / −0.33s / −0.66s.
   - Driver mark: 22 × 26 triangle in `#F5F7FA` with
     `drop-shadow(0 0 12px rgba(47,155,224,0.9))`. In `6a`/`6b` it sits at 34%
     of map height so it clears the focus panel.
   - Heading chip top-left: `NORTHBOUND · ANZAC HWY`, 11px/700 on `#07090C`.
   - Alert markers: police is a 34px white square with a two-lamp bar across the
     top 9px and a black `P` below; hazard and crash are 28px squares, 2px white
     border, dark fill, letter `H` / `X`. Each carries a distance chip beneath.
     In `6a` they are pinned in the clear band between chip and panel (top 44 /
     64 / 50, left 22 / 96 / 300) rather than positioned by percentage — the
     percentages re-collide whenever the panel height changes.
   - **Focus panel** overlaps the bottom of the map. See below.
4. **Ledger** — header row `ALSO AHEAD` (dim) / `2 MORE` (blue), then one row
   per alert: 6px left severity rail, a left-to-right tint fading to
   transparent, title 17px/900, subtitle `PLACE · CONFIDENCE-OR-AGE`, and a
   right-aligned distance of 24px/900 numeral + `KM`. High severity uses the red
   rail with a 0.20 → 0.03 → 0 tint and gains the animated two-lamp bar at the
   left; medium uses the amber rail with a 0.12 → 0.02 → 0 tint. The focused
   alert is **removed** from the ledger — the panel is already showing it.
5. **Speed row** — full width, `linear-gradient(180deg, #0A1E30, #060D16)`.
   `SPEED` label in blue at left, `ONE TAP TO REPORT` in `#4FB0EE` at right, then
   the speed numeral at 60px/900, letter-spacing −2px, with `KM/H` in blue.
6. **Report bar** — three equal cells, 84px tall, divided by section rules:

   | Cell | Icon | Stroke | Ground |
   | --- | --- | --- | --- |
   | POLICE | Lucide `siren` | `#F0453A` | `rgba(224,27,36,0.22)` → `0.06` |
   | ACCIDENT | Lucide `car-front` | `#4FB0EE` | `#14395C` → `#0A2338` |
   | HAZARD | Lucide `triangle-alert` | `#E8930C` | `rgba(232,147,12,0.18)` → `0.05` |

   Icons are 30px, stroke-width 2, above a 13px/900 white label, both flush left
   with 14px padding. Each cell is ~130 × 84 — comfortably past the 44px minimum
   for a glance-free tap while driving.
7. **Tab bar** — RADIO / HISTORY / SETTINGS. The active tab takes a 2px blue top
   border, blue label, a `rgba(47,155,224,0.16)` → transparent wash, and a 44 × 2
   blue underline with a soft glow. Inactive tabs are dim with a left rule.

### The light bar

Two lamps alternating on a 460ms `steps(1, end)` cycle, in antiphase:

```css
@keyframes hudLightBlue {
  0%, 49.9% { background: #3D6BFF; box-shadow: 0 0 6px 1px rgba(61,107,255,0.85); }
  50%, 100% { background: rgba(61,107,255,0.18); box-shadow: none; }
}
@keyframes hudLightRed {
  0%, 49.9% { background: rgba(255,61,61,0.18); box-shadow: none; }
  50%, 100% { background: #FF3D3D; box-shadow: 0 0 6px 1px rgba(255,61,61,0.85); }
}
```

Used at 30 × 13 in the ledger row and the panel, and at full width across the
top of the police map marker. This is the only motion in the UI besides the
radar rings — keep it that way.

---

## The focus panel

Overlaps the bottom of the map: `rgba(7,9,12,0.94)`, `border-top: 1px solid
#2F9BE0`, `box-shadow: 0 -6px 18px rgba(7,9,12,0.7)`, padding `8px 20px 10px`.

**Heading-toward state (`6a`)**, three tiers:

1. Kicker `CLOSEST · HEADING TOWARD` in blue, with `12° LEFT · CLOSING` dim at
   the right.
2. Light bar, then `POLICE` at 20px/900 over `ANZAC HWY, GLANDORE · NORTHBOUND`;
   right-aligned `1.2 KM` at 30px/900 in `#F0453A` with `70 S AT 62 KM/H`
   beneath it — closing time computed from current speed, not a static string.
3. Above a section rule: `CONFIDENCE — HIGH · 3×`, `REPORTED — 4 MIN AGO`, and a
   138 × 44 `CONFIRM / STILL THERE?` button on the blue gradient.

**Heading-away state (`6b`)**: the panel collapses to a kicker
`CLOSEST · 68° OFF HEADING` and one dim line
`POLICE, ANZAC HWY — NOT ON YOUR PATH`. No numerals, no button, no light bar.

### Behaviour to wire up

- **Which alert gets focused** — the nearest alert that passes the existing
  announce gate: bearing difference within `ANNOUNCE_MAX_BEARING_DIFF_DEG` (45°)
  and distance inside the announce window. Reuse `src/geo/announceWindow.ts`
  rather than duplicating the thresholds; the panel and the voice line must
  never disagree about what's ahead.
- **Past 45°** — render the stood-down state. Do not hide the panel entirely;
  the driver should be able to tell the difference between "nothing near" and
  "something near but not on your path".
- **Closing time** — distance ÷ current speed, recomputed on each position
  update, suppressed below ~10 km/h so it doesn't read `∞`.
- **STILL THERE?** — the existing corroboration call
  (`PATCH /api/reports/:id`), optimistic, with the confirm count incrementing in
  place. 44px minimum target; no confirmation dialog.
- **Report cells** — reuse `src/store/manualReportAlert.ts`. One tap files at the
  current position, no confirmation step, undo via a brief inline state on the
  cell rather than a toast.
- **Ledger** — excludes the focused alert; the `2 MORE` count reflects that.

---

## Constraints

- 390 × 844 is the design target. The map is the only element that should flex
  vertically; the header, speed row, report bar and tab bar are fixed.
- No corner radius anywhere. No shadows other than the two glows and the panel
  lift specified above.
- Nothing below 10px, and nothing tappable below 44px.
- Every row title, place name and subtitle truncates with ellipsis on one line —
  the driver is not reading a second line.
- Motion is limited to the light bar and the radar rings. Respect
  `prefers-reduced-motion` by freezing both to their lit/mid state.
- History and Settings are still drawn on the older mono instrument face in the
  design doc. If you build them now, carry the HUD tokens across rather than
  mixing the two faces in one app.
