/**
 * Creates the `speed_limits` table: South Australia's posted speed
 * limits as road-segment polylines, loaded once (and re-run manually)
 * by scripts/loadSpeedLimits.js from the DIT "Speed Zones" MapServer
 * behind data.sa.gov.au (Location SA). The app's live speed-limit
 * lookup currently hits Overpass/OSM per-trip (src/geo/
 * speedLimitLookup.ts); this table is the authoritative-source
 * replacement that a future /api/speed-limit endpoint can serve from.
 *
 * `geom` is geography(MultiLineString, 4326) - matching alerts.location's
 * choice of geography over geometry so ST_DWithin("what limit applies
 * near this point") works in metres directly, and MultiLineString so a
 * DIT feature made of several disjoint paths still stores as one row.
 * Coordinates arrive [lng, lat] from the ArcGIS service (outSR=4326)
 * and are stored in that same order inside the WKT.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE speed_limits (
      id TEXT PRIMARY KEY,
      geom geography(MultiLineString, 4326) NOT NULL,
      road_name TEXT NOT NULL,
      speed_limit_kmh SMALLINT NOT NULL CHECK (speed_limit_kmh > 0),
      side TEXT,
      source TEXT NOT NULL,
      last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // The "what's the limit here" lookup is a spatial nearest-segment
  // query - keep it indexed.
  pgm.sql('CREATE INDEX speed_limits_geom_gist ON speed_limits USING gist (geom)');
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE speed_limits');
};
