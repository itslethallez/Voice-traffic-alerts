-- Run once against a fresh Neon database (e.g. via the Neon SQL editor, or
-- `psql "$DATABASE_URL" -f server/schema.sql`) before the API is used for
-- the first time. Not applied automatically - there's no migration runner
-- in this project, matching its "no backend in v1" -> "one small backend,
-- kept simple" scope.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE fixed_cameras (
  id TEXT PRIMARY KEY,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  road_name TEXT NOT NULL,
  camera_type TEXT NOT NULL CHECK (camera_type IN ('fixed', 'mobile_zone')),
  source TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- device_id and heading_deg are additions beyond the brief's original
-- column list: device_id is required to do any per-device rate limiting
-- or per-device history at all (the chosen abuse-prevention model), and
-- heading_deg preserves the compass-direction display HistoryScreen.tsx
-- already shows for a report today - without it, a report would lose its
-- direction the moment it's fetched back from the server after a relaunch.
CREATE TABLE user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  category TEXT NOT NULL DEFAULT 'POLICE',
  subtype TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  heading_deg DOUBLE PRECISION,
  note TEXT,
  confidence INTEGER NOT NULL DEFAULT 1,
  corroboration_count INTEGER NOT NULL DEFAULT 0,
  device_id TEXT NOT NULL,
  -- Starts equal to created_at (both DEFAULT now()) and is bumped by a
  -- confirmation from another device (see report_confirmations below) - the
  -- single source of truth for whether a report is still "live" (within
  -- LIVE_REPORT_WINDOW_MS of it, client-side) or has aged out with no one
  -- else corroborating it.
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_reports_device_id_created_at_idx ON user_reports (device_id, created_at DESC);

-- Added after the table above first shipped (report-category picker: Police
-- gets a Visible/Hidden subtype, Accident/Hazard don't) - there's still no
-- migration runner, so this is the idempotent way for an already-provisioned
-- database to pick up the new column without re-running the CREATE TABLE.
ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS subtype TEXT;
ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Waze's own alerts (police/accident/hazard/road-closed/jam), mirrored
-- server-side by scripts/refreshWazeAlerts.js on a schedule (GitHub
-- Actions, not a Vercel Cron - see that script's header comment for why).
-- Nothing in the app reads this table yet: the mobile client still polls
-- OpenWeb Ninja directly (src/api/waze/client.ts) for its live alert
-- pipeline, unchanged. This is a passive, continuously-refreshed copy of
-- what Waze is reporting, independent of any one device's trip.
CREATE TABLE IF NOT EXISTS waze_alerts (
  id TEXT PRIMARY KEY, -- Waze's own alert_id
  type TEXT NOT NULL,
  subtype TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  street TEXT,
  city TEXT,
  reported_at TIMESTAMPTZ, -- Waze's publish_datetime_utc
  reliability INTEGER,
  confidence INTEGER,
  num_thumbs_up INTEGER,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lets a cleanup query cheaply find alerts no run has seen in a while,
-- without a full table scan.
CREATE INDEX IF NOT EXISTS waze_alerts_last_seen_at_idx ON waze_alerts (last_seen_at);

-- One row per device that has confirmed a given report ("still there?"),
-- and the thing that makes a confirmation idempotent per device - the
-- (report_id, device_id) primary key is what stops a single device from
-- confirming the same report over and over to keep it alive by itself.
-- ON DELETE CASCADE: if a report is ever deleted (removeManualReport /
-- DELETE /api/reports), its confirmation rows have no reason to survive it.
CREATE TABLE IF NOT EXISTS report_confirmations (
  report_id UUID NOT NULL REFERENCES user_reports(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, device_id)
);
