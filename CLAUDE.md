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
| 1 | Strip Navigate (PR #6) | merged |
| 2 | Feed fixes (PRs #7, #8) | merged |
| 3 | Cruise core | merged (PRs #14, #5); Valhalla follow-up is **PR #16** |
| 3c | Direction-aware warning zone (see below) | agreed 28 Nov; build after #16 |
| 8 | Visual refresh | |
| 4 | Handoff (Waze / Google Maps / Apple Maps) | |
| 5 | Reroute | |
| 6 | National data | |
| 7 | Community pipeline | plan approved; code only after stages 3–5 |

## Stage 3c - direction-aware warning zone (agreed 28 Nov 2026)

Replaces the 20 Nov "behind is silent" call. **Cruise mode only** (not
Navigate). Every alert inside the driver's warning zone is announced with
its direction - this is a selling point over other apps:

| Where the alert is | Spoken |
|---|---|
| On my road, in front | "ahead on [road], X away" (unchanged) |
| Direction not certain / road matching down | "in your warning area, X away" (replaces "nearby") |
| Behind me / needs a U-turn - **police and mobile cameras only** | "behind you, X away", **once** per alert |
| Behind me - any other type (crash, roadwork, hazard...) | silent, as now |

Still no reroute offer for police or cameras, behind or ahead.

## Current status (as of 28 Nov 2026)

**PRs #6, #14 and #5 are merged** into `claude/voice-traffic-alerts-os1jef`
(in that order). Stage 3 Cruise core is done apart from Valhalla (PR #16).

**Stage 3 Cruise core (PR #14, merged).** Road matching (`src/road/`,
`[road]` tag): "ahead on X" only when Mapbox Directions confirms the alert is
on the driver's road with no turn off it; otherwise "nearby, X away";
behind / U-turn is silent. Per-type distances behind one Close / Normal / Far
setting. Speech fixes: call-detection screen-off crash, native timers for
prefetch / briefing gaps / 20s watchdog, silent device-voice warm-up, 2s
Google wait, suburb resolved before briefing prefetch. Audit cases A-F (+D)
are fixtures in `src/road/__tests__/aheadCases.test.ts`. 754/754 tests.

**21 Nov follow-up (same branch):** road-match cost cut (route reused
per road segment, lookups only inside the warn radius, 30s per-target
spacing, shared server cache `server/api/road/forward-route.ts` - **live since
28 Nov** at `https://shotgun-api-zeta.vercel.app/api/road/forward-route`,
verified miss -> Mapbox, then hit for the next driver). Divided-road reports ("on [road], X" with no side),
2x detour. Screen-off cold start now alerts (background location at
launch + expo-location patch, built from source via
`expo.autolinking.android.buildFromSource`). Briefing sentences frozen
before prefetch; `EXPO_PUBLIC_BRIEFING_FIXTURE=1` forces a 3-item briefing
in drive-test builds only. 778/778 tests.

**PR #5 (merged):** native puck/follow, 30s background silence fixed
(background fixes are only ignored while the app is on screen).

**Vercel backend (28 Nov):** project `shotgun-api` in team `insanelysmart`,
root `server/`, functions in `syd1`. Production now builds from
`claude/voice-traffic-alerts-os1jef` (it was `main`, which is stale, so
prod had been 70 days old). `MAPBOX_ACCESS_TOKEN` set for Production +
Preview (the app's pk. token); Upstash via the `KV_REST_API_*` vars.
`server/` is linked locally (`server/.vercel`, git-ignored).

**Valhalla (branch `stage-3b-valhalla`, on top of #5 + main):** case C
(same-named report within 60m of my road is "on [road]" whatever the
router does) and case F (camera on another road is silent; unknown road
still warns). Valhalla-first road matching with Mapbox fallback
(`server/lib/valhalla.ts`), server + weekly OSM update + runbook in
`infra/valhalla/`, watchdog probe, Settings -> MAP DATA credits. Code
complete and tested (841/841), **PR #16**, checks green. **Server not
provisioned yet** - waiting only on `DIGITALOCEAN_TOKEN` reaching the
session. After that: `VALHALLA_URL` + `VALHALLA_SHARED_SECRET` in Vercel,
the GitHub secrets/variables in `infra/valhalla/README.md`, then merge #16.
Until then production road matching runs on Mapbox only.

**Open PRs:**

| PR | What it is | State |
|----|-----------|-------|
| #16 | Stage 3b Valhalla-first road matching (Mapbox fallback), cases C and F | open, checks green; merge once Valhalla is provisioned |

Merged: #5, #6, #7, #8, #9, #12, #13, #14. #15 closed (duplicate of #14).
