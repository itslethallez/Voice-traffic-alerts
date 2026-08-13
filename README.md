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
- No backend in v1 — see "API key" below.

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

### Simulated drive (Steps 6-7, replaced in Step 8)

Steps 6-7 built the Drive and Settings screens against a simulated driver
(a position advancing at constant speed along a fixed heading) rather than
real GPS, so the screens were demoable in Expo Go before real location
existed. Step 8 replaced that simulation with real `expo-location`
foreground and background tracking; the mock *alerts* fixture is still in
use until Step 9 swaps in the live Waze client.

### Real location (Step 8)

`src/trip/tripRuntime.ts` is the one place a driver position turns into
"maybe speak an alert" - it's a plain module (not a React hook or
component), so it's reachable from both `src/screens/useDriveLoop.ts`
(foreground: requests permission, then `Location.watchPositionAsync`) and
`src/background/locationTask.ts` (a `TaskManager.defineTask` registered at
module scope in `index.ts`, so the OS can run it even with no app UI
mounted). Sharing one runtime means a trip's pending announcement queue and
announced-alert dedupe stay consistent regardless of whether a given
location fix arrives while the app is foregrounded or backgrounded.

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

## Build status

- [x] Step 1: Expo scaffold, TypeScript config, folder structure, env handling
- [x] Step 2: Typed Waze API client + mock fixtures
- [x] Step 3: Geo utilities + unit tests
- [x] Step 4: Polling and filtering engine
- [x] Step 5: Speech queue and audio session config
- [x] Step 6: Drive screen
- [x] Step 7: Settings screen and persistence
- [x] Step 8: Background location task
- [ ] Step 9: Swap mock for live API

## Non-goals for v1

No accounts, no user-submitted reports, no map view, no routing, no CarPlay
or Android Auto, no backend.
