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

| # | Stage | Status |
|---|-------|--------|
| 1 | Strip Navigate (PR #6) | in test |
| 2 | Feed fixes (PRs #7, #8) | |
| 3 | Cruise core | |
| 4 | Handoff (Waze / Google Maps / Apple Maps) | |
| 5 | Reroute | |
| 6 | National data | |
| 7 | Community pipeline | plan approved; code only after stages 3–5 |
| 8 | Visual refresh | |
