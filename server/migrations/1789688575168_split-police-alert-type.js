/**
 * Splits the flat 'police' alert type into three: 'police' stays the
 * live/reported sighting (crowd_api, user_report, fb_agent), while
 * scheduled enforcement gets its own types - 'mobile_camera' for
 * police_notice rows (the SA scraper's published camera windows) and
 * 'fixed_camera' for fixed_db rows (permanent camera infrastructure).
 * Matches shared/alert-schema.ts's widened AlertTypeSchema.
 *
 * Order matters: the CHECK constraint must accept the new values before
 * the UPDATE writes them, and on the way down the rows must be back to
 * 'police' before the old constraint is restored.
 */
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE alerts DROP CONSTRAINT alerts_type_check`);
  pgm.sql(`
    ALTER TABLE alerts ADD CONSTRAINT alerts_type_check
      CHECK (type IN ('police', 'mobile_camera', 'fixed_camera', 'traffic', 'accident', 'closure', 'roadkill', 'hazard'))
  `);
  pgm.sql(`UPDATE alerts SET type = 'mobile_camera' WHERE type = 'police' AND source = 'police_notice'`);
  pgm.sql(`UPDATE alerts SET type = 'fixed_camera' WHERE type = 'police' AND source = 'fixed_db'`);
};

exports.down = (pgm) => {
  pgm.sql(`UPDATE alerts SET type = 'police' WHERE type IN ('mobile_camera', 'fixed_camera')`);
  pgm.sql(`ALTER TABLE alerts DROP CONSTRAINT alerts_type_check`);
  pgm.sql(`
    ALTER TABLE alerts ADD CONSTRAINT alerts_type_check
      CHECK (type IN ('police', 'traffic', 'accident', 'closure', 'roadkill', 'hazard'))
  `);
};
