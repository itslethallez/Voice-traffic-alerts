@AGENTS.md

# SHOTGUN — standing brief

## Product

Shotgun is a **co-pilot, not a navigation app**.

- **Cruise mode is the core and the default.** No destination needed. It is
  what the app opens into and what every other feature is built around.
- A destination is **optional**. When the driver sets one, Shotgun **hands
  off** to Waze, Google Maps or Apple Maps and keeps alerting in the
  background. Shotgun does not draw the turn-by-turn.
- Launch scope is **Australia-wide**.

## Rules

- **Stage by stage.** Finish one stage, stop, and wait for my check before
  starting the next. Do not run stages together.
- **Degraded confidence is always disclosed.** If a feed is stale, a source
  is down, or coverage is thin, say so in the UI and in the voice.
  **Silence must never read as "all clear."**
- **Road awareness positioning.** Shotgun tells the driver what is ahead.
  **Never offer a reroute for police or cameras** — not as a prompt, not as
  a route option, not as a nudge.
- **Official/licensed sources only.** Facebook-derived data is **facts
  only**: incident type, location, time. **Never** usernames, photos,
  comments, or the original wording.
- **Keep diagnostic log tags on all new systems** (`[speech]`, `[trip]`,
  `[drive]`, `[map]`, `[perf]`, …). A new subsystem ships with its own tag
  so a drive test can be read back from logcat (Android emulator) or the
  Xcode / Console.app device log (iPhone).

## Test devices

- **The iPhone is the only physical test device.** Real drive tests,
  screen-off / locked-phone voice checks and background-location checks
  are done on the iPhone, from a TestFlight build (`eas build -p ios
  --profile production --auto-submit`; `production` is the only
  store-distribution profile with an App Store Connect app id).
- **Android is emulator-only** until the owner gets an Android phone.
  Use the emulator for screenshots, UI work and simulated GPS routes;
  never treat an emulator result as proof of real background behaviour.
- Any fix to background location, audio or screen-off speech must be
  made for **both** platforms, and checked on the iPhone.

## Approved exceptions

- **One always-on routing server (approved 21 Nov 2026).** The
  `.windsurfrules` stack rule "never introduce an always-on service" has one
  exception: a single self-hosted **Valhalla** routing server in the
  **Sydney** region, used for road matching (option C: Valhalla first,
  Mapbox Directions only as fallback when Valhalla errors or times out).
  It does not extend to any other always-on service - ask again for
  anything else. Its data is OpenStreetMap, so **"© OpenStreetMap
  contributors"** must appear on the app's attribution screen.

## Stages

Rows are in **build order** (reordered 20 Nov 2026: visual refresh moved
up to run straight after Cruise core). Stage numbers are kept as labels so
existing references to "stage 4", "stage 7" etc. stay valid.

| # | Stage | Status |
|---|-------|--------|
| 1 | Strip Navigate (PR #6) | **done, pushed** |
| 2 | Feed fixes (PRs #7, #8) | merged |
| 3 | Cruise core | **PR #14, awaiting merge** (branch `stage-3-cruise-core`) |
| 8 | Visual refresh | |
| 4 | Handoff (Waze / Google Maps / Apple Maps) | |
| 5 | Reroute | |
| 6 | National data | |
| 7 | Community pipeline | plan approved; code only after stages 3–5 |

## Current status (as of 21 Nov 2026)

**Stage 1 (PR #6)** pushed, unchanged since 20 Nov.

**Stage 3 Cruise core is PR #14** - branch `stage-3-cruise-core`, based
on PR #6's branch. Road matching (`src/road/`,
`[road]` tag): "ahead on X" only when Mapbox Directions confirms the alert is
on the driver's road with no turn off it; otherwise "nearby, X away";
behind / U-turn is silent. Per-type distances behind one Close / Normal / Far
setting. Speech fixes: call-detection screen-off crash, native timers for
prefetch / briefing gaps / 20s watchdog, silent device-voice warm-up, 2s
Google wait, suburb resolved before briefing prefetch. Audit cases A-F (+D)
are fixtures in `src/road/__tests__/aheadCases.test.ts`. 754/754 tests.

**21 Nov follow-up (same branch):** road-match cost cut (route reused
per road segment, lookups only inside the warn radius, 30s per-target
spacing, shared server cache `server/api/road/forward-route.ts` - built,
NOT deployed: needs a backend URL in the app and `MAPBOX_ACCESS_TOKEN` +
Upstash on the server). Divided-road reports ("on [road], X" with no side),
2x detour. Screen-off cold start now alerts (background location at
launch + expo-location patch, built from source via
`expo.autolinking.android.buildFromSource`). Briefing sentences frozen
before prefetch; `EXPO_PUBLIC_BRIEFING_FIXTURE=1` forces a 3-item briefing
in drive-test builds only. 778/778 tests.

**PR #5** now has PR #6 and Stage 3 (#14) merged in (RadarMap conflict resolved keeping #6's
driver-centred Cruise camera) and the 30s background silence fixed
(background fixes are only ignored while the app is on screen). Merge order: **#6, then #14, then #5**; the puck-centring carry-forward is done.

**Valhalla (branch `stage-3b-valhalla`, on top of #5 + main):** case C
(same-named report within 60m of my road is "on [road]" whatever the
router does) and case F (camera on another road is silent; unknown road
still warns). Valhalla-first road matching with Mapbox fallback
(`server/lib/valhalla.ts`), server + weekly OSM update + runbook in
`infra/valhalla/`, watchdog probe, Settings -> MAP DATA credits. Code
complete and tested (841/841); **not provisioned yet** - waiting on
DIGITALOCEAN_TOKEN reaching the session, a Vercel project for `server/`
(none exists), and the Vercel env vars.

**Open PRs:**

| PR | What it is | State |
|----|-----------|-------|
| #5 | Native nav state — native puck/follow, failed-reroute progress, spoken reroute notices | open, merge after #14 |
| #6 | This Stage 1 work — Navigate behind a flag, background voice fix, puck centring | open |
| #14 | Stage 3 Cruise core — road matching, screen-off alerting, fewer Mapbox calls | open, merge after #6 |
| #7 | Feed health watchdog — opens a GitHub issue when a data feed dies silently | merged |
| #8 | ScraperAPI Australian-IP + retry handling so the SA feeds work on the free plan | merged |
