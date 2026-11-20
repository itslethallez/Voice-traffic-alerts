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
| 3 | Cruise core | |
| 8 | Visual refresh | |
| 4 | Handoff (Waze / Google Maps / Apple Maps) | |
| 5 | Reroute | |
| 6 | National data | |
| 7 | Community pipeline | plan approved; code only after stages 3–5 |

## Current status (as of 20 Nov 2026)

**Stage 1 done and pushed to PR #6** (`devin/1794925532-strip-navigate`):
background voice now survives screen-off/locked (background-location task
was requesting `Accuracy.Balanced`, which never powers the GPS chip — fixed
to `Accuracy.High` at the foreground watch's cadence), and the Cruise
camera now centres on the driver instead of drifting to the midpoint with
the nearest alert. 666/666 tests pass.

**Known gap:** the driver puck graphic itself doesn't render in this build
(isolated to `DriverMark.tsx`'s `SvgXml` usage — the only consumer of that
react-native-svg API in the codebase; likely a New-Architecture
incompatibility). Not patched here — **PR #5 deletes `DriverMark.tsx`
outright** and replaces it with a native puck, so this is left for PR #5
rather than fixed twice. The camera-centring fix itself is confirmed not
already covered by PR #5 (checked — same midpoint bug is still there) and
will need carrying forward when PR #5 lands.

**TTS latency measured, proposal only (not built):** of the ~936ms average
delay before a driver hears anything, that's Google TTS's network fetch,
not the spoken sentence itself (which isn't a latency problem). Recommended:
(1) prefetch TTS audio as soon as an alert becomes a likely candidate,
mirroring the existing `prefetchSpeedLimit` pattern, **plus** (2) switch the
fixed-checkpoint speed-camera warning specifically to the on-device voice
as primary rather than fallback, since it's the one safety-critical,
split-second case and needs no new caching infra. Pre-caching the small
fixed speed-camera phrase set is a reasonable alternative to (2) if voice
consistency matters more than latency there — flagged, not decided.

**Open PRs:**

| PR | What it is | State |
|----|-----------|-------|
| #5 | Native nav state — native puck/follow, failed-reroute progress, spoken reroute notices | open |
| #6 | This Stage 1 work — Navigate behind a flag, background voice fix, puck centring | open |
| #7 | Feed health watchdog — opens a GitHub issue when a data feed dies silently | merged |
| #8 | ScraperAPI Australian-IP + retry handling so the SA feeds work on the free plan | merged |
