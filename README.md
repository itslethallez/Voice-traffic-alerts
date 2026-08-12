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
  background/   expo-task-manager background location task (Step 8)
  config/       Environment/config access (this step)
```

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
- [ ] Step 5: Speech queue and audio session config
- [ ] Step 6: Drive screen
- [ ] Step 7: Settings screen and persistence
- [ ] Step 8: Background location task
- [ ] Step 9: Swap mock for live API

## Non-goals for v1

No accounts, no user-submitted reports, no map view, no routing, no CarPlay
or Android Auto, no backend.
