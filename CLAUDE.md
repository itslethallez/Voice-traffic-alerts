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
  so a drive test can be read back from logcat.

## Stages

Rows are in **build order** (reordered 20 Nov 2026: visual refresh moved
up to run straight after Cruise core). Stage numbers are kept as labels so
existing references to "stage 4", "stage 7" etc. stay valid.

| # | Stage | Status |
|---|-------|--------|
| 1 | Strip Navigate (PR #6) | **done, pushed** |
| 2 | Feed fixes (PRs #7, #8) | merged |
| 3 | Cruise core | **built, awaiting check** (local branch `stage-3-cruise-core`) |
| 8 | Visual refresh | |
| 4 | Handoff (Waze / Google Maps / Apple Maps) | |
| 5 | Reroute | |
| 6 | National data | |
| 7 | Community pipeline | plan approved; code only after stages 3–5 |

## Current status (as of 21 Nov 2026)

**Stage 1 (PR #6)** pushed, unchanged since 20 Nov.

**Stage 3 Cruise core built, not pushed** - local branch
`stage-3-cruise-core` (3 commits on top of PR #6). Road matching (`src/road/`,
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

**PR #5** now has PR #6 merged in (RadarMap conflict resolved keeping #6's
driver-centred Cruise camera) and the 30s background silence fixed
(background fixes are only ignored while the app is on screen). Ready to
merge after #6; the puck-centring carry-forward is done.

**Open PRs:**

| PR | What it is | State |
|----|-----------|-------|
| #5 | Native nav state — native puck/follow, failed-reroute progress, spoken reroute notices | open, ready after #6 |
| #6 | This Stage 1 work — Navigate behind a flag, background voice fix, puck centring | open |
| #7 | Feed health watchdog — opens a GitHub issue when a data feed dies silently | merged |
| #8 | ScraperAPI Australian-IP + retry handling so the SA feeds work on the free plan | merged |
