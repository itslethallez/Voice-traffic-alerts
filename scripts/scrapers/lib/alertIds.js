const crypto = require('crypto');

/**
 * Deterministic UUID (v5-style layout over a SHA-256 digest) for
 * source-stable alert identity. A scraper that re-publishes the same
 * underlying notice every run - e.g. a camera listed Mon-Sun scraped
 * nightly - must produce the same alert id each time so POST /api/ingest
 * upserts instead of stacking duplicate rows. The key should capture
 * everything that makes the notice *itself*: source + location + window,
 * never anything fetched incidentally like geocode results (which can
 * jitter between runs).
 */
function deterministicAlertId(namespace, key) {
  const bytes = crypto.createHash('sha256').update(`${namespace}:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

module.exports = { deterministicAlertId };
