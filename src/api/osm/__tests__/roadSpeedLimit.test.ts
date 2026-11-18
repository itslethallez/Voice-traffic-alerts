import { fetchSpeedLimitNear } from '../roadSpeedLimit';

function mockOverpassResponse(elements: unknown[]) {
  (globalThis.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ elements }),
  });
}

const POINT = { latitude: -34.9, longitude: 138.6 };

describe('fetchSpeedLimitNear', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  it('returns the maxspeed of the nearest way (by closest node)', async () => {
    mockOverpassResponse([
      {
        type: 'way',
        tags: { highway: 'primary', maxspeed: '60' },
        // Nodes far from POINT.
        geometry: [
          { lat: -34.95, lon: 138.65 },
          { lat: -34.96, lon: 138.66 },
        ],
      },
      {
        type: 'way',
        tags: { highway: 'secondary', maxspeed: '50' },
        // A node very close to POINT.
        geometry: [{ lat: -34.9001, lon: 138.6001 }],
      },
    ]);

    const result = await fetchSpeedLimitNear(POINT);
    expect(result).toBe(50);
  });

  it('parses a plain integer maxspeed string', async () => {
    mockOverpassResponse([
      { type: 'way', tags: { maxspeed: '80' }, geometry: [{ lat: -34.9, lon: 138.6 }] },
    ]);
    expect(await fetchSpeedLimitNear(POINT)).toBe(80);
  });

  it('returns null for a non-numeric maxspeed value rather than guessing', async () => {
    mockOverpassResponse([
      { type: 'way', tags: { maxspeed: 'AU:urban' }, geometry: [{ lat: -34.9, lon: 138.6 }] },
    ]);
    expect(await fetchSpeedLimitNear(POINT)).toBeNull();
  });

  it('returns null when no ways are found nearby', async () => {
    mockOverpassResponse([]);
    expect(await fetchSpeedLimitNear(POINT)).toBeNull();
  });

  it('returns null for a way with no maxspeed tag at all', async () => {
    mockOverpassResponse([{ type: 'way', tags: {}, geometry: [{ lat: -34.9, lon: 138.6 }] }]);
    expect(await fetchSpeedLimitNear(POINT)).toBeNull();
  });

  it('throws on a non-OK response', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 504 });
    await expect(fetchSpeedLimitNear(POINT)).rejects.toThrow('504');
  });
});
