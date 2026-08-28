# Voice Traffic Alerts

A hands-free co-pilot that speaks live road alerts to a driver so they never
have to look at a screen. Alerts (police, accidents, hazards, road closures,
traffic jams) come from the OpenWeb Ninja Waze API, filtered down to what is
genuinely ahead of the driver and read aloud with text to speech.

## Stack

- Expo (React Native), TypeScript, managed workflow
- `expo-location` for foreground and background position
- `expo-speech` for text to speech
- `expo-task-manager` for the background location task
- Zustand for state
- `server/` — a small Vercel + Neon Postgres backend for fixed camera
  locations and user-submitted reports (see "Central database" below).
  The Waze API itself still has no backend of its own — see "API key"
  below.

## Project structure

```
src/
  api/waze/     Typed Waze API client and response types (Step 2)
  geo/          Haversine distance, bearing, bounding-box math (Step 3)
  engine/       Pure polling + alert-filtering engine, no UI (Step 4)
  speech/       TTS announcement queue and audio session setup (Step 5)
  screens/      DriveScreen, SettingsScreen (Steps 6-7)
  store/        Zustand stores (settings, trip state)
  location/     Permission flow and LocationObject -> DriverState conversion (Step 8)
  background/   expo-task-manager background location task (Step 8)
  trip/         Shared runtime tying location -> engine -> speech together (Step 8)
  config/       Environment/config access (Step 1)
```

### Simulated drive (Steps 6-7, replaced in Step 8-9)

Steps 6-7 built the Drive and Settings screens against a simulated driver
(a position advancing at constant speed along a fixed heading) rather than
real GPS, so the screens were demoable in Expo Go before real location
existed. Step 8 replaced that simulation with real `expo-location`
foreground and background tracking, and Step 9 replaced the mock alerts
fixture with the live Waze client - the app no longer uses simulated or
mock data for anything at runtime. `src/api/waze/__mocks__/alerts.fixture.ts`
is kept purely as a test fixture now.

### Real location and live polling (Steps 8-9)

`src/trip/tripRuntime.ts` is the one place a driver position turns into
"maybe fetch fresh alerts, maybe speak one" - it's a plain module (not a
React hook or component), so it's reachable from both
`src/screens/useDriveLoop.ts` (foreground: requests permission, then
`Location.watchPositionAsync`) and `src/background/locationTask.ts` (a
`TaskManager.defineTask` registered at module scope in `index.ts`, so the
OS can run it even with no app UI mounted). Sharing one runtime means a
trip's pending announcement queue, announced-alert dedupe, movement/speed
history and alerts cache stay consistent regardless of whether a given
location fix arrives while the app is foregrounded or backgrounded.

On every driver update, `tripRuntime` runs `engine/pollPlanner.ts`'s
moving/stationary/paused decision (45s moving, 5 minutes stationary, pause
after 15 minutes with no movement - Step 4's logic, only actually wired up
to a real fetch now) to decide whether it's time to hit the live API, using
`engine/cache.ts` to keep serving the last successful response on failure.
`api/waze/fetchAlertsForBoundingBox.ts` re-queries as four quadrants
(`geo/quadrants.ts`) and merges + dedupes by `alert_id`
(`api/waze/mergeAlerts.ts`) whenever a response hits the 200-alert cap - the
signal that an area holds more alerts than one call can return. A rate
limit (`WazeApiError.isRateLimited`) shows the "small banner" once and
backs off exponentially (`trip/backoff.ts`, 1 minute up to a 15 minute
ceiling) instead of hammering the API on the normal cadence; any other
fetch failure marks the status line "Offline" while still serving cache.
Speaking itself (not data freshness) is also gated on master mute and on
Step 4's `engine/speedGate.ts` sustained-low-speed check (the
passenger/train edge case - built in Step 4 but only wired in here).

Permission handling (`src/location/permissions.ts`) follows the spec's two
separate edge cases: foreground denied blocks the app entirely, with a
one-line explanation swapped in for the status line; background denied
still lets the app work normally in the foreground, with a small banner
noting alerts will stop when the app isn't open. `src/location/toDriverState.ts`
converts a raw GPS sample into the engine's `DriverState`, including a
fallback for missing/unreliable heading (common at low speed) that derives
a bearing from the previous position instead.

**Expo Go limitation:** per expo-task-manager's own docs, `TaskManager` is
not available on Android in Expo Go, and doesn't support background
execution on iOS in Expo Go either - a development build is required to
exercise the background task for real. This step's real-device/background
behavior (permission dialogs, actual GPS, speech while backgrounded)
couldn't be exercised in the sandboxed environment this was built in; it's
verified as far as static analysis and `expo prebuild` go (typecheck,
tests, a clean `expo export`, and a `expo prebuild --platform ios` run
confirming the generated Info.plist has the right permission strings and
`UIBackgroundModes`), not on a physical device or simulator.

## Setup

Requires Node 22.x and pnpm. All commands below use semicolons so they work
as-is in PowerShell 5.1.

```powershell
pnpm install
Copy-Item .env.example .env
```

Then open `.env` and fill in your OpenWeb Ninja API key:

```
EXPO_PUBLIC_WAZE_API_KEY=your-key-here
```

Start the dev server:

```powershell
pnpm start
```

Run the unit tests:

```powershell
pnpm test
```

## Waze API

Verified against the OpenWeb Ninja Waze API docs (`https://www.openwebninja.com/api/waze/docs`
and `https://www.openwebninja.com/api/waze`), cross-checked against a verbatim sample
response from a mirror of the same API
(https://zylalabs.com/api-marketplace/travel/waze+alerts+and+jams+information+api/1910).

- `GET https://api.openwebninja.com/waze/alerts-and-jams`
- Auth: `x-api-key` header
- Query params: `bottom_left`, `top_right` (each `"lat,lon"`), `max_alerts` (max 200, default 20), `max_jams` (max 800, default 20 — set to 0 to skip fetching jam segments, which this app doesn't use)
- No server-side alert-type filter exists, so category filtering (police/accident/hazard/etc) happens client-side against the `type` field
- Response: `{ status, request_id, parameters, data: { alerts: WazeAlert[], jams: [] } }`

See `src/api/waze/types.ts` for the full typed `WazeAlert` shape and `src/api/waze/client.ts`
for the client. `src/api/waze/__mocks__/alerts.fixture.ts` has 20 sample alerts for building
the rest of the app offline.

## API key: this needs a proxy before public release

`EXPO_PUBLIC_*` environment variables are inlined into the JavaScript bundle
at build time. That is what makes local development simple — the app calls
`api.openwebninja.com` directly with no backend — but it also means the key
ships inside the app binary and can be extracted by anyone who has the app
installed. That's acceptable for development and personal use, but **do not
ship this to public app stores as-is**. Before a public release, put a thin
proxy (or serverless function) between the app and OpenWeb Ninja that holds
the real key server-side, and point the app at that proxy instead.

## Central database

Fixed camera locations and user-submitted police reports live in a Neon
Postgres database, reachable only through `server/`'s Vercel serverless
functions - the app never holds database credentials, the same "proxy
before public release" principle as the Waze key above. See
`server/schema.sql` for the two tables and `server/api/*.ts` for the
endpoints.

- Manual reports (`ReportButton`) sync to `POST /api/reports` in the
  background and are read back on app start via `GET /api/reports?deviceId=`,
  so they survive a relaunch - previously they were pure in-memory state.
- Other devices' nearby reports are fetched via
  `GET /api/reports?deviceId=&lat=&lng=&radiusMeters=` on the same cadence
  as the Waze poll, so a driver can see - and confirm - another driver's
  report on their own map. A report a driver made is private to their own
  device until someone else's app requests this endpoint and it happens to
  be nearby and still live.
- A report stays "live" (shown on the map/feed) for `LIVE_REPORT_WINDOW_MS`
  (25 minutes, `src/store/manualReportAlert.ts`) since it was created or
  last confirmed, whichever is more recent - after that it simply drops out
  of both the map/feed and the nearby-reports query, though the row itself
  is kept (History still shows it for the reporter). Tapping another
  device's report marker sends `PATCH /api/reports?id=` ("still there?"),
  which resets that window and increments `corroboration_count`; the
  backend rejects a device confirming its own report, and a second
  confirmation from the same device is a no-op (`report_confirmations`'
  `(report_id, device_id)` primary key).
- Fixed cameras are fetched from `GET /api/cameras` at trip start,
  falling back to the bundled `src/data/fixedSpeedCameras.ts` snapshot if
  the fetch fails. `scripts/buildFixedCameraDataset.js` ingests SAPOL's
  published fixed-camera list into the `fixed_cameras` table (re-run it
  occasionally; it no longer writes the bundled TS file).
- Abuse prevention on the public write endpoints is an anonymous
  per-device ID (`src/config/deviceId.ts`) plus server-side rate limiting
  on new reports - no accounts. See `server/api/reports.ts` for the
  current limits.
- Voice notes and full user accounts remain explicitly out of scope.
- `fixed_cameras` and the new `waze_alerts` table (below) are both kept
  fresh by scheduled GitHub Actions workflows, not a Vercel Cron - see
  "Scheduled data refresh" below for why, and what secrets they need.

### Waze alert mirror

`waze_alerts` (`server/schema.sql`) is a passive, continuously-refreshed
copy of what OpenWeb Ninja's Waze proxy is currently reporting for South
Australia. **The app itself does not read this table** - `src/api/waze/client.ts`
still polls OpenWeb Ninja directly, per device, per trip, exactly as
before. This table exists independently of any one device being on a
trip, for future use (history, analytics, or eventually replacing the
client's direct Waze calls - see "API key" above for why that'd also be
worth doing eventually). `scripts/refreshWazeAlerts.js` does the fetch +
upsert + stale-row cleanup, on the same pattern as
`buildFixedCameraDataset.js`.

### Scheduled data refresh

Both ingest scripts (`scripts/buildFixedCameraDataset.js`,
`scripts/refreshWazeAlerts.js`) run on **GitHub Actions**
(`.github/workflows/refresh-fixed-cameras.yml`,
`.github/workflows/refresh-waze-alerts.yml`), not a Vercel Cron:

- The camera scraper shells out to `curl` to get past SAPOL's WAF (see
  that script's header comment) - Vercel's Node serverless runtime doesn't
  reliably provide a `curl` binary, while a GitHub Actions runner always
  does.
- Vercel Cron's minimum interval depends on the linked project's plan;
  GitHub Actions' `schedule` trigger doesn't, which matters for the Waze
  mirror running every 5 minutes.

Both workflows read secrets from the repo's Settings → Secrets and
variables → Actions, then write them into a throwaway `.env` file before
running the script (both scripts already only know how to read `.env`,
not `process.env` directly - this keeps them identical whether run
locally or in CI). Required secrets:

- `DATABASE_URL` - same Neon connection string `server/`'s API functions use.
- `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` - for the camera workflow's geocoding.
- `EXPO_PUBLIC_WAZE_API_KEY` - for the Waze mirror workflow.

Both also support `workflow_dispatch`, so either can be run on demand from
the Actions tab instead of waiting for the schedule.

## Build status

- [x] Step 1: Expo scaffold, TypeScript config, folder structure, env handling
- [x] Step 2: Typed Waze API client + mock fixtures
- [x] Step 3: Geo utilities + unit tests
- [x] Step 4: Polling and filtering engine
- [x] Step 5: Speech queue and audio session config
- [x] Step 6: Drive screen
- [x] Step 7: Settings screen and persistence
- [x] Step 8: Background location task
- [x] Step 9: Swap mock for live API
- [x] Central database: Neon Postgres behind a Vercel API for fixed
      cameras and user reports (see "Central database" above)

## Non-goals for v1

No accounts, no routing, no CarPlay or Android Auto, no centralized voice
note storage, no social-media scraping.
