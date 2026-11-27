const {
  parseCameraAddress,
  roadKey,
  placeFromOsm,
  checkPlacement,
  distanceToBoundsKm,
} = require('../cameraPlacement.js');

const p = (latitude: number, longitude: number) => ({ latitude, longitude });

describe('parseCameraAddress', () => {
  it('reads an intersection, expanding abbreviations', () => {
    expect(parseCameraAddress('South Rd/Richmond Road, MILE END SOUTH')).toEqual({
      kind: 'intersection',
      roads: ['South Road', 'Richmond Road'],
      suburbs: ['MILE END SOUTH'],
    });
  });
  it('copes with spaced slashes and a missing comma', () => {
    expect(parseCameraAddress('Main North Road / Kings Road, PARAFIELD')?.roads).toEqual(['Main North Road', 'Kings Road']);
    expect(parseCameraAddress('Tapleys Hill Road/West Lakes Boulevard SEATON')?.suburbs).toEqual(['SEATON']);
  });
  it('reads a point-to-point range', () => {
    expect(parseCameraAddress('Sturt Highway, WOOLPUNDA TO KANNI')).toEqual({
      kind: 'range',
      roads: ['Sturt Highway'],
      suburbs: ['WOOLPUNDA', 'KANNI'],
    });
  });
  it('keeps a leading "St" that is not a street type', () => {
    expect(parseCameraAddress('St Bernards Road, MAGILL')?.roads).toEqual(['St Bernards Road']);
  });
});

describe('roadKey', () => {
  it('treats Mapbox abbreviations as the same road, but Stuart is not Sturt', () => {
    expect(roadKey('Sturt Hwy')).toBe(roadKey('Sturt Highway'));
    expect(roadKey('Stuart Hwy')).not.toBe(roadKey('Sturt Highway'));
  });
  it.each([
    ['Main N Rd', 'Main North Road'],
    ['Northern Expy', 'Northern Expressway'],
    ['West Ter', 'West Terrace'],
    ['Commercial St W', 'Commercial Street West'],
    ['S Eastern Fwy', 'South Eastern Freeway'],
  ])('matches Mapbox "%s" to SAPOL "%s"', (mapbox, sapol) => {
    expect(roadKey(mapbox)).toBe(roadKey(sapol));
  });
});

describe('SAPOL quirks', () => {
  it('expands a mid-name direction and drops a median-strip suffix', () => {
    expect(parseCameraAddress('Lower Nth East Road/Darley Road, PARADISE')?.roads).toEqual(['Lower North East Road', 'Darley Road']);
    expect(parseCameraAddress('Main North Road/Yorketown Road M/S, ELIZABETH PARK')?.roads).toEqual([
      'Main North Road',
      'Yorktown Road',
    ]);
  });
  it('only corrects the Yorketown typo in Elizabeth Park', () => {
    expect(parseCameraAddress('Yorketown Road, YORKETOWN')?.roads).toEqual(['Yorketown Road']);
  });
});

// Two named roads crossing at a shared node, inside a small suburb box.
const suburb = { minLat: -34.89, minLng: 138.58, maxLat: -34.87, maxLng: 138.6 };
const ways = [
  { name: 'Churchill Road', nodes: [1, 2, 3], geometry: [p(-34.9, 138.584), p(-34.8745, 138.584), p(-34.86, 138.584)] },
  { name: 'Regency Road', nodes: [4, 2, 5], geometry: [p(-34.8745, 138.57), p(-34.8745, 138.584), p(-34.8745, 138.6)] },
];

describe('placeFromOsm', () => {
  it('puts an intersection camera on the shared junction node', () => {
    const result = placeFromOsm(parseCameraAddress('Churchill Road/Regency Road, PROSPECT'), ways, [suburb]);
    expect(result).toEqual({ position: p(-34.8745, 138.584), method: 'osm-junction' });
  });
  it('puts a mid-block camera on the named road inside the suburb', () => {
    const result = placeFromOsm(parseCameraAddress('Churchill Road, PROSPECT'), ways, [suburb]);
    expect(result.position.longitude).toBeCloseTo(138.584, 5);
    expect(distanceToBoundsKm(result.position, suburb)).toBe(0);
  });
  it('fails rather than guessing when a road is missing', () => {
    expect(placeFromOsm(parseCameraAddress('Churchill Road/Nowhere Street, PROSPECT'), ways, [suburb]).failure).toMatch(
      /Nowhere Street/,
    );
  });
});

describe('checkPlacement (the 5 km check)', () => {
  const woolpunda = { minLat: -34.3, minLng: 139.85, maxLat: -34.15, maxLng: 139.99 };
  const kanni = { minLat: -34.302, minLng: 139.959, maxLat: -34.188, maxLng: 140.141 };
  const parsed = parseCameraAddress('Sturt Highway, WOOLPUNDA TO KANNI');

  it('flags the old Woolpunda-Kanni pin on the Stuart Highway at Port Augusta', () => {
    const pin = { label: 'Sturt Highway, WOOLPUNDA TO KANNI', position: p(-32.479241, 137.752358) };
    const problems = checkPlacement(pin, parsed, ['Stuart Hwy', 'Eyre Hwy', 'Daw St'], [woolpunda, kanni]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/Sturt Highway is not within 5 km/);
    expect(problems[1]).toMatch(/km from WOOLPUNDA \/ KANNI/);
  });
  it('passes a pin on the Sturt Highway between the two localities', () => {
    const pin = { label: 'Sturt Highway, WOOLPUNDA TO KANNI', position: p(-34.22, 139.97) };
    expect(checkPlacement(pin, parsed, ['Sturt Hwy'], [woolpunda, kanni])).toEqual([]);
  });
  it('needs both roads of an intersection nearby', () => {
    const pin = { label: 'x', position: p(-34.8745, 138.584) };
    const both = parseCameraAddress('Churchill Road/Regency Road, PROSPECT');
    expect(checkPlacement(pin, both, ['Churchill Rd'], [suburb])).toEqual(['Regency Road is not within 5 km']);
  });
  it('flags a suburb it cannot locate instead of passing it', () => {
    const pin = { label: 'x', position: p(-34.8745, 138.584) };
    expect(checkPlacement(pin, parseCameraAddress('Churchill Road, PROSPECT'), ['Churchill Rd'], [null])).toEqual([
      'unknown suburb PROSPECT',
    ]);
  });
});
