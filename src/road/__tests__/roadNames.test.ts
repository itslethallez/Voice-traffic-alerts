import { normalizeRoadName, roadNamesIn, sameRoad } from '../roadNames';

describe('normalizeRoadName', () => {
  it('matches the same road across Waze, Mapbox, SAPOL and police-notice spellings', () => {
    expect(sameRoad('A1 - Main North Rd', 'Main North Road')).toBe(true);
    expect(sameRoad('PORTRUSH RD', 'Portrush Road')).toBe(true);
    expect(sameRoad('R1 - Fitzroy Tce (City Ring Route)', 'Fitzroy Terrace')).toBe(true);
  });

  it('never treats different roads as the same one', () => {
    expect(sameRoad('Main North Road', 'Main South Road')).toBe(false);
    expect(sameRoad('Portrush Road', 'Portrush Street')).toBe(false);
  });

  it('has no usable name for a bare route number, a ramp description or nothing', () => {
    expect(normalizeRoadName('A1')).toBeNull();
    expect(normalizeRoadName('to South Rd to A7 - Port Road')).toBeNull();
    expect(normalizeRoadName('')).toBeNull();
    expect(sameRoad(null, null)).toBe(false);
  });
});

describe('roadNamesIn', () => {
  it('splits an intersection label into both roads and drops the suburb', () => {
    expect(roadNamesIn('Kensington Road/Portrush Road, MARRYATVILLE')).toEqual(['Kensington Road', 'Portrush Road']);
    expect(roadNamesIn(null)).toEqual([]);
  });
});
