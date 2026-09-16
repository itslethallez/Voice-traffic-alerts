# shotgun-api

Vercel serverless API in front of Neon Postgres. The Expo app never holds
DB credentials — it only calls this.

## Layout

- `api/` — one Vercel function per endpoint (`/api/reports`, `/api/cameras`, `/api/ingest`)
- `lib/` — `db.ts` (Neon), `redis.ts` (Upstash cache), `sentry.ts`, `notify.ts` (alert fan-out)
- `migrations/` — node-pg-migrate migrations for the `alerts` table and onward
- `../shared/alert-schema.ts` — the Zod schema every alert is validated against at `/api/ingest`

`schema.sql` is the legacy one-shot setup for the pre-existing tables
(`fixed_cameras`, `user_reports`, …) — still run once on a fresh database.
New tables go through `migrations/` instead.

## Setup

```sh
cd server
npm install
cp .env.example .env   # fill in DATABASE_URL (Neon branch), INGEST_SECRET, etc.
npm run migrate        # applies migrations/ against DATABASE_URL
```

Run locally with `vercel dev` once a Vercel project is linked, or exercise
the handlers via `pnpm jest server/` from the repo root.

## Verify the ingest path

```sh
curl -X POST http://localhost:3000/api/ingest \
  -H 'content-type: application/json' \
  -H 'x-ingest-secret: dev-secret' \
  -d '{"type":"police","lat":-34.92,"lng":138.60,"radius_m":250,"confidence":80,"source":"user_report","first_seen":"2026-09-17T04:00:00Z","expires_at":"2026-09-17T05:00:00Z","corroboration_count":0}'
```

Then confirm in Postgres (`geography` column should read back as a point):

```sql
SELECT id, type, ST_AsText(location::geometry) FROM alerts ORDER BY created_at DESC LIMIT 1;
```

## Notes

- Migrations: `npm run migrate` / `npm run migrate:down`. Chose
  node-pg-migrate over Prisma — it's a thin SQL runner that fits the
  existing raw-`sql` data layer; Prisma would add an ORM + codegen step
  for a handful of endpoints.
- `alerts.location` is PostGIS `geography(Point,4326)` — `ST_DWithin`
  works in metres directly for the corridor query in Phase 1.
- Redis is a cache only; live delivery is Expo push + polling, and
  scheduled/queue work is Vercel Cron + QStash (see `../.windsurfrules`).
