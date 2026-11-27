/**
 * Placement + sanity check for SAPOL fixed-camera sites.
 *
 * SAPOL publishes each site as text only ("Road A/Road B, SUBURB",
 * "Road, SUBURB" or "Road, X TO Y" for a point-to-point section) - no
 * coordinates. Mapbox free-text geocoding cannot place these reliably:
 * it has no intersection search (it returns one point somewhere on Road
 * A), it lacks some gazetted SA localities (Woolpunda, Kanni), and it
 * fuzzy-matches road names - "Sturt Highway, WOOLPUNDA TO KANNI" landed
 * on the *Stuart* Highway at Port Augusta, ~230 km away.
 *
 * So positions come from OpenStreetMap (same ODbL data as the approved
 * Valhalla server; "© OpenStreetMap contributors" is already on the
 * attribution screen): the node where the two named roads meet, or the
 * point on the named road nearest the suburb. That is computed offline
 * by scripts/buildFixedCameraPlacements.js and committed as
 * scripts/data/sapol-camera-placements.json, because the public
 * Overpass servers are too slow/unreliable to hit from a weekly job.
 *
 * Every camera - curated or Mapbox fallback - then has to pass
 * checkPlacement(): its named road(s) must be within 5 km (Mapbox
 * Tilequery against the streets tileset) and it must be within 5 km of
 * its named suburb's bounds. Anything that fails is not written.
 */

const MAX_OFFSET_KM = 5;

const ROAD_ABBREVIATIONS = {
  rd: 'road',
  st: 'street',
  hwy: 'highway',
  ave: 'avenue',
  av: 'avenue',
  tce: 'terrace',
  dr: 'drive',
  pde: 'parade',
  bvd: 'boulevard',
  blvd: 'boulevard',
  fwy: 'freeway',
  pl: 'place',
  cres: 'crescent',
  hwys: 'highways',
};

/**
 * Misspellings in SAPOL's own table, keyed "Road|SUBURB" so a real road
 * of the misspelt name elsewhere is untouched. Site 88 is the median
 * strip of the Main North Road / Yorktown Road junction (site 87).
 */
const SAPOL_TYPOS = {
  'Yorketown Road|ELIZABETH PARK': 'Yorktown Road',
};

/** Direction words SAPOL abbreviates anywhere in a name ("Lower Nth East Road"). */
const NAME_ABBREVIATIONS = { nth: 'North', sth: 'South' };

/** "South Rd" -> "South Road", "Lower Nth East Rd" -> "Lower North East Road". */
function expandRoadName(name) {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word, index, words) => {
      const key = word.toLowerCase().replace(/\.$/, '');
      if (NAME_ABBREVIATIONS[key]) return NAME_ABBREVIATIONS[key];
      // Only the last word is a street type ("St Agnes Road" keeps its St).
      if (index === words.length - 1 && ROAD_ABBREVIATIONS[key]) {
        const full = ROAD_ABBREVIATIONS[key];
        return full[0].toUpperCase() + full.slice(1);
      }
      return word;
    })
    .join(' ');
}

/**
 * Comparison key only (never displayed or queried): every word expanded,
 * because Mapbox's streets tileset abbreviates harder than SAPOL or OSM -
 * "Main N Rd", "Northern Expy", "West Ter", "Commercial St W".
 */
const KEY_WORDS = {
  ...ROAD_ABBREVIATIONS,
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  nth: 'north',
  sth: 'south',
  ter: 'terrace',
  expy: 'expressway',
  pkwy: 'parkway',
  hwy: 'highway',
};

function roadKey(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    // A leading "St" is Saint ("St Bernards Rd"); anywhere else it's Street.
    .map((word, index) => (index === 0 && word === 'st' ? 'saint' : KEY_WORDS[word] ?? word))
    .join(' ');
}

function suburbKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "Main North Road / Kings Road, PARAFIELD" ->
 *   { kind: 'intersection', roads: ['Main North Road', 'Kings Road'], suburbs: ['PARAFIELD'] }
 * "Dukes Highway COONALPYN TO KI KI" ->
 *   { kind: 'range', roads: ['Dukes Highway'], suburbs: ['COONALPYN', 'KI KI'] }
 * Returns null when no trailing upper-case suburb can be found.
 */
function parseCameraAddress(address) {
  const text = String(address).replace(/\s+/g, ' ').trim();
  const match = text.match(/^(.*?)[,\s]+((?:[A-Z][A-Z'-]+)(?:\s+[A-Z][A-Z'-]+)*)$/);
  if (!match) return null;
  const roads = match[1]
    // "Yorketown Road M/S" = the median strip of that road, not a third road.
    .replace(/\s+M\/S\b/gi, '')
    .split('/')
    .map((road) => expandRoadName(road.replace(/,$/, '')))
    .filter(Boolean);
  const suburbs = match[2].split(/\s+TO\s+/).map((s) => s.trim()).filter(Boolean);
  if (roads.length === 0 || suburbs.length === 0) return null;
  for (let i = 0; i < roads.length; i++) {
    roads[i] = SAPOL_TYPOS[`${roads[i]}|${suburbs[0]}`] ?? roads[i];
  }
  const kind = suburbs.length > 1 ? 'range' : roads.length > 1 ? 'intersection' : 'midblock';
  return { kind, roads, suburbs };
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

/** Bounds are { minLat, minLng, maxLat, maxLng }. 0 when the point is inside. */
function distanceToBoundsKm(point, bounds) {
  const clamped = {
    latitude: Math.min(Math.max(point.latitude, bounds.minLat), bounds.maxLat),
    longitude: Math.min(Math.max(point.longitude, bounds.minLng), bounds.maxLng),
  };
  return haversineKm(point, clamped);
}

function unionBounds(list) {
  return list.reduce((acc, b) => ({
    minLat: Math.min(acc.minLat, b.minLat),
    minLng: Math.min(acc.minLng, b.minLng),
    maxLat: Math.max(acc.maxLat, b.maxLat),
    maxLng: Math.max(acc.maxLng, b.maxLng),
  }));
}

function boundsCentre(b) {
  return { latitude: (b.minLat + b.maxLat) / 2, longitude: (b.minLng + b.maxLng) / 2 };
}

/**
 * Nearest point to `target` on a polyline (array of {latitude, longitude}),
 * projected onto a local equirectangular plane around the target - exact
 * enough at the few-km scale these sites need.
 */
function nearestPointOnLine(target, line) {
  const kx = Math.cos((target.latitude * Math.PI) / 180);
  const toXY = (p) => ({ x: (p.longitude - target.longitude) * kx, y: p.latitude - target.latitude });
  let best = null;
  for (let i = 0; i < line.length; i++) {
    const a = toXY(line[i]);
    const b = toXY(line[i + 1] ?? line[i]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lenSq));
    const x = a.x + t * dx;
    const y = a.y + t * dy;
    const d = x * x + y * y;
    if (!best || d < best.d) {
      best = { d, point: { latitude: target.latitude + y, longitude: target.longitude + x / kx } };
    }
  }
  return best ? best.point : null;
}

/**
 * Pure placement from OSM data. `ways` are { name, nodes: [id], geometry: [{latitude, longitude}] };
 * `suburbBounds` is the bounds for each of parsed.suburbs (same order).
 * Returns { position, method } or { failure }.
 */
function placeFromOsm(parsed, ways, suburbBounds) {
  const area = unionBounds(suburbBounds);
  const target = boundsCentre(
    parsed.kind === 'range'
      ? unionBounds([boundsFromPoint(boundsCentre(suburbBounds[0])), boundsFromPoint(boundsCentre(suburbBounds[1]))])
      : area,
  );
  const waysFor = (road) => ways.filter((w) => roadKey(w.name) === roadKey(road));

  if (parsed.kind === 'intersection') {
    const [first, second] = parsed.roads;
    const aWays = waysFor(first);
    const bWays = waysFor(second);
    if (aWays.length === 0) return { failure: `no OSM road named ${first} near ${parsed.suburbs[0]}` };
    if (bWays.length === 0) return { failure: `no OSM road named ${second} near ${parsed.suburbs[0]}` };

    const aNodes = new Map();
    for (const w of aWays) w.nodes.forEach((id, i) => aNodes.set(id, w.geometry[i]));
    const shared = [];
    for (const w of bWays) w.nodes.forEach((id, i) => aNodes.has(id) && shared.push(w.geometry[i]));

    if (shared.length > 0) {
      // Several shared nodes = divided carriageways or the same pair of
      // roads meeting twice. Take the meeting nearest the suburb, then
      // average the nodes of that one junction.
      const ranked = shared
        .map((p) => ({ p, d: distanceToBoundsKm(p, area) * 1000 + haversineKm(p, target) }))
        .sort((x, y) => x.d - y.d);
      const anchor = ranked[0].p;
      const cluster = shared.filter((p) => haversineKm(p, anchor) <= 0.15);
      return {
        position: {
          latitude: round6(cluster.reduce((s, p) => s + p.latitude, 0) / cluster.length),
          longitude: round6(cluster.reduce((s, p) => s + p.longitude, 0) / cluster.length),
        },
        method: 'osm-junction',
      };
    }

    // No shared node (grade-separated interchange, slip-lane-only
    // connection): closest approach between the two roads, if they
    // genuinely meet (<= 300 m apart).
    let best = null;
    for (const a of aWays) {
      for (const p of a.geometry) {
        for (const b of bWays) {
          const q = nearestPointOnLine(p, b.geometry);
          const d = haversineKm(p, q);
          const score = d + distanceToBoundsKm(p, area);
          if (!best || score < best.score) best = { score, d, p, q };
        }
      }
    }
    if (!best || best.d > 0.3) {
      return { failure: `${first} and ${second} do not meet near ${parsed.suburbs[0]} in OSM` };
    }
    return {
      position: {
        latitude: round6((best.p.latitude + best.q.latitude) / 2),
        longitude: round6((best.p.longitude + best.q.longitude) / 2),
      },
      method: 'osm-closest-approach',
    };
  }

  const roadWays = waysFor(parsed.roads[0]);
  if (roadWays.length === 0) return { failure: `no OSM road named ${parsed.roads[0]} near ${parsed.suburbs.join(' / ')}` };
  let best = null;
  for (const w of roadWays) {
    const p = nearestPointOnLine(target, w.geometry);
    const score = haversineKm(p, target) + distanceToBoundsKm(p, area) * 10;
    if (!best || score < best.score) best = { score, p };
  }
  return {
    position: { latitude: round6(best.p.latitude), longitude: round6(best.p.longitude) },
    method: parsed.kind === 'range' ? 'osm-road-midsection' : 'osm-road-in-suburb',
  };
}

function boundsFromPoint(p) {
  return { minLat: p.latitude, minLng: p.longitude, maxLat: p.latitude, maxLng: p.longitude };
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * The 5 km check. `nearbyRoadNames` are the road names Mapbox Tilequery
 * returns within MAX_OFFSET_KM of the camera (nearest 50); `suburbBounds`
 * are the bounds of each named suburb (null when unknown). Returns a list
 * of problems - empty means the camera is where its label says.
 *
 * Tilequery returns the 50 nearest road features, so in a dense grid a
 * named road 3 km away can be missing from the list - that flags a
 * camera which is not on/near its road, which is what we want.
 */
function checkPlacement(camera, parsed, nearbyRoadNames, suburbBounds) {
  const problems = [];
  if (!parsed) return [`cannot parse road/suburb from "${camera.label}"`];
  const nearby = new Set(nearbyRoadNames.map(roadKey));
  for (const road of parsed.roads) {
    if (!nearby.has(roadKey(road))) problems.push(`${road} is not within ${MAX_OFFSET_KM} km`);
  }
  const known = suburbBounds.filter(Boolean);
  if (known.length !== parsed.suburbs.length) {
    problems.push(`unknown suburb ${parsed.suburbs.filter((_, i) => !suburbBounds[i]).join(', ')}`);
  } else {
    const area = unionBounds(known);
    const offKm = distanceToBoundsKm(camera.position, area);
    if (offKm > MAX_OFFSET_KM) {
      problems.push(`${offKm.toFixed(0)} km from ${parsed.suburbs.join(' / ')}`);
    }
  }
  return problems;
}

module.exports = {
  MAX_OFFSET_KM,
  expandRoadName,
  roadKey,
  suburbKey,
  parseCameraAddress,
  haversineKm,
  distanceToBoundsKm,
  unionBounds,
  nearestPointOnLine,
  placeFromOsm,
  checkPlacement,
};
