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
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  heading_deg DOUBLE PRECISION,
  note TEXT,
  confidence INTEGER NOT NULL DEFAULT 1,
  corroboration_count INTEGER NOT NULL DEFAULT 0,
  device_id TEXT NOT NULL
);

CREATE INDEX user_reports_device_id_created_at_idx ON user_reports (device_id, created_at DESC);
