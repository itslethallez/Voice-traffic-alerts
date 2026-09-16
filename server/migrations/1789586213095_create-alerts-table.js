/**
 * Creates the normalized `alerts` table - the single table every ingestion
 * source writes into via POST /api/ingest. Its columns mirror
 * shared/alert-schema.ts field-for-field: the Zod schema is enforced in TS
 * at the endpoint, and the CHECK constraints below are the same invariants
 * on the database side, so a hand-run SQL insert can't produce a row the
 * schema would reject.
 *
 * `location` is geography(Point, 4326), not a plain lat/lng pair and not
 * geometry: ST_DWithin over geography works in metres directly, which is
 * what the corridor-relevance query (GET /alerts/nearby) needs without
 * projecting. Requires the postgis extension - Neon supports it natively.
 */
exports.up = (pgm) => {
  pgm.createExtension('postgis', { ifNotExists: true });
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.sql(`
    CREATE TABLE alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL CHECK (type IN ('police', 'traffic', 'accident', 'closure', 'roadkill', 'hazard')),
      location geography(Point, 4326) NOT NULL,
      radius_m DOUBLE PRECISION NOT NULL CHECK (radius_m >= 0),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
      source TEXT NOT NULL CHECK (source IN ('crowd_api', 'police_notice', 'fixed_db', 'fb_agent', 'user_report')),
      first_seen TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      corroboration_count INTEGER NOT NULL DEFAULT 0 CHECK (corroboration_count >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // The corridor query's spatial filter.
  pgm.sql('CREATE INDEX alerts_location_gist ON alerts USING gist (location)');
  // "Still live" is the first filter on every alert read - keep it cheap.
  pgm.sql('CREATE INDEX alerts_expires_at_idx ON alerts (expires_at)');
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE alerts');
  // Extensions deliberately left installed - pgcrypto predates this
  // migration and other tables may rely on either.
};
