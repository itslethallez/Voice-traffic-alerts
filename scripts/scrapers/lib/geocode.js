/**
 * Mapbox forward geocoding for police-notice addresses - the notices are
 * "STREET, SUBURB" strings with no coordinates, so each is resolved
 * against Mapbox exactly the way scripts/buildFixedCameraDataset.js does
 * for SAPOL's fixed-camera table (same endpoint, same suburb cross-check).
 *
 * One refinement over the fixed-camera version: notices name a whole
 * street stretch, and plenty of those streets run along suburb
 * boundaries - a strict "returned locality must equal the notice's
 * suburb" check rejects ~20% of real notices (the geocode lands metres
 * into the neighbouring suburb). So validation is two-stage:
 *   1. the notice's suburb is geocoded once (cached per run) and used as
 *      a `proximity` bias on the street query;
 *   2. a result is accepted when its context names the suburb, OR when
 *      it lands within SUBURB_FALLBACK_RADIUS_KM of the suburb's own
 *      geocode - boundary streets pass, wrong-town snaps (observed:
 *      "DAYS RD, CROYDON PARK" resolving to a Days Rd in Murtho, 200km
 *      away) still fail.
 */

const MAPBOX_FORWARD_URL = 'https://api.mapbox.com/search/geocode/v6/forward';

/** How far a geocoded street point may sit from the notice's suburb
 * centroid and still be accepted when the context labels don't match -
 * covers boundary roads without letting cross-state name collisions
 * through. */
const SUBURB_FALLBACK_RADIUS_KM = 15;

/** Case/whitespace-insensitive - "CUMBERLAND PARK" vs "Cumberland Park". */
function namesMatch(a, b) {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

async function forwardGeocode(query, accessToken, proximity) {
  const url = new URL(MAPBOX_FORWARD_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('access_token', accessToken);
  if (proximity) url.searchParams.set('proximity', `${proximity.longitude},${proximity.latitude}`);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Mapbox forward geocode failed (${response.status}) for "${query}"`);
  }
  const data = await response.json();
  const properties = data.features?.[0]?.properties;
  if (!properties) return null;
  const context = properties.context ?? {};
  return {
    position: { latitude: properties.coordinates.latitude, longitude: properties.coordinates.longitude },
    locality: context.locality?.name ?? null,
    place: context.place?.name ?? null,
    district: context.district?.name ?? null,
    neighborhood: context.neighborhood?.name ?? null,
  };
}

/**
 * Geocodes a bare suburb name once per run per suburb (module-level
 * cache: scripts are one-shot processes, and notices repeat suburbs
 * heavily). Used for proximity bias + the distance fallback.
 */
const suburbCache = new Map();
async function geocodeSuburb(suburb, region, accessToken) {
  const key = `${suburb}|${region}`;
  if (!suburbCache.has(key)) {
    const result = await forwardGeocode(`${suburb}, ${region}`, accessToken).catch(() => null);
    suburbCache.set(key, result?.position ?? null);
  }
  return suburbCache.get(key);
}

/**
 * Geocodes `query` and verifies the result sits in/near the suburb the
 * notice named (see module comment for the two-stage rule). Returns
 * { position } on a confirmed match, or { failure: reason } on
 * no-match / wrong-locality so callers can report and skip rather than
 * emit a mislocated alert.
 */
async function geocodeNoticeAddress(query, expectedSuburb, accessToken, { region } = {}) {
  const suburbPos = expectedSuburb && region ? await geocodeSuburb(expectedSuburb, region, accessToken) : null;
  const result = await forwardGeocode(query, accessToken, suburbPos);
  if (!result) return { failure: 'no match' };

  const contextNames = [result.locality, result.place, result.district, result.neighborhood];
  if (contextNames.some((name) => namesMatch(expectedSuburb, name))) return { position: result.position };

  if (suburbPos && haversineKm(result.position, suburbPos) <= SUBURB_FALLBACK_RADIUS_KM) {
    return { position: result.position };
  }
  return {
    failure: `suburb mismatch: expected ${expectedSuburb}, got ${result.locality ?? result.place}`,
  };
}

module.exports = { forwardGeocode, geocodeNoticeAddress, namesMatch };
