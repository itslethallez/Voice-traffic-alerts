const fetchSpeedLimitNear = jest.fn<Promise<number | null>, unknown[]>();

jest.mock('../../api/osm/roadSpeedLimit', () => ({
  fetchSpeedLimitNear: (...args: unknown[]) => fetchSpeedLimitNear(...args),
}));

describe('speedLimitLookup', () => {
  beforeEach(() => {
    jest.resetModules();
    fetchSpeedLimitNear.mockReset();
  });

  it('fetches once, then serves the cached limit on a later call with no second fetch', async () => {
    const { prefetchSpeedLimit, getCachedSpeedLimit } = require('../speedLimitLookup');
    fetchSpeedLimitNear.mockResolvedValue(60);
    const point = { latitude: -34.9, longitude: 138.6 };

    await prefetchSpeedLimit(point);
    expect(getCachedSpeedLimit(point)).toBe(60);

    await prefetchSpeedLimit(point);
    expect(fetchSpeedLimitNear).toHaveBeenCalledTimes(1);
  });

  it('is unresolved (undefined) until a prefetch is attempted', () => {
    const { getCachedSpeedLimit } = require('../speedLimitLookup');
    expect(getCachedSpeedLimit({ latitude: -34.9, longitude: 138.6 })).toBeUndefined();
  });

  it('quantizes coordinates that round to the same ~100m point onto one fetch', async () => {
    const { prefetchSpeedLimit } = require('../speedLimitLookup');
    fetchSpeedLimitNear.mockResolvedValue(80);

    await prefetchSpeedLimit({ latitude: -34.9001, longitude: 138.6001 });
    await prefetchSpeedLimit({ latitude: -34.9000, longitude: 138.6002 });

    expect(fetchSpeedLimitNear).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent prefetches for the same point to a single in-flight request', async () => {
    const { prefetchSpeedLimit } = require('../speedLimitLookup');
    let resolveFetch: (value: number | null) => void = () => {};
    fetchSpeedLimitNear.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    const point = { latitude: -34.9, longitude: 138.6 };

    const first = prefetchSpeedLimit(point);
    const second = prefetchSpeedLimit(point);
    resolveFetch(60);
    await Promise.all([first, second]);

    expect(fetchSpeedLimitNear).toHaveBeenCalledTimes(1);
  });

  it('caches null (not left unresolved) when the fetch rejects, so it is not retried', async () => {
    const { prefetchSpeedLimit, getCachedSpeedLimit } = require('../speedLimitLookup');
    fetchSpeedLimitNear.mockRejectedValue(new Error('timed out'));
    const point = { latitude: -34.9, longitude: 138.6 };

    await prefetchSpeedLimit(point);

    expect(getCachedSpeedLimit(point)).toBeNull();
    await prefetchSpeedLimit(point);
    expect(fetchSpeedLimitNear).toHaveBeenCalledTimes(1);
  });

  it('caches a null result from a successful fetch that found no major road nearby', async () => {
    const { prefetchSpeedLimit, getCachedSpeedLimit } = require('../speedLimitLookup');
    fetchSpeedLimitNear.mockResolvedValue(null);
    const point = { latitude: -34.9, longitude: 138.6 };

    await prefetchSpeedLimit(point);

    expect(getCachedSpeedLimit(point)).toBeNull();
  });
});
