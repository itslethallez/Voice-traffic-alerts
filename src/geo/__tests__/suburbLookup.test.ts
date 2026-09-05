const fetchSuburbForPoint = jest.fn<Promise<string | null>, unknown[]>();

jest.mock('../../api/mapbox/reverseGeocode', () => ({
  fetchSuburbForPoint: (...args: unknown[]) => fetchSuburbForPoint(...args),
}));

let mapboxAccessToken = 'test-token';
jest.mock('../../config/env', () => ({
  get env() {
    return { mapboxAccessToken };
  },
}));

describe('suburbLookup', () => {
  beforeEach(() => {
    jest.resetModules();
    fetchSuburbForPoint.mockReset();
    mapboxAccessToken = 'test-token';
  });

  it('fetches once, then serves the cached suburb on a later call with no second fetch', async () => {
    const { prefetchSuburb, getCachedSuburb } = require('../suburbLookup');
    fetchSuburbForPoint.mockResolvedValue('Modbury North');
    const point = { latitude: -34.818022, longitude: 138.681585 };

    await prefetchSuburb(point);
    expect(getCachedSuburb(point)).toBe('Modbury North');

    await prefetchSuburb(point);
    expect(fetchSuburbForPoint).toHaveBeenCalledTimes(1);
  });

  it('is unresolved (undefined) until a prefetch is attempted', () => {
    const { getCachedSuburb } = require('../suburbLookup');
    expect(getCachedSuburb({ latitude: -34.9, longitude: 138.6 })).toBeUndefined();
  });

  it('quantizes coordinates that round to the same ~100m point onto one fetch', async () => {
    const { prefetchSuburb } = require('../suburbLookup');
    fetchSuburbForPoint.mockResolvedValue('Modbury North');

    await prefetchSuburb({ latitude: -34.818022, longitude: 138.681585 });
    await prefetchSuburb({ latitude: -34.8180, longitude: 138.6816 });

    expect(fetchSuburbForPoint).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent prefetches for the same point to a single in-flight request', async () => {
    const { prefetchSuburb } = require('../suburbLookup');
    let resolveFetch: (value: string | null) => void = () => {};
    fetchSuburbForPoint.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    const point = { latitude: -34.818022, longitude: 138.681585 };

    const first = prefetchSuburb(point);
    const second = prefetchSuburb(point);
    resolveFetch('Modbury North');
    await Promise.all([first, second]);

    expect(fetchSuburbForPoint).toHaveBeenCalledTimes(1);
  });

  it('caches null (not left unresolved) when the fetch rejects, so it is not retried', async () => {
    const { prefetchSuburb, getCachedSuburb } = require('../suburbLookup');
    fetchSuburbForPoint.mockRejectedValue(new Error('timed out'));
    const point = { latitude: -34.818022, longitude: 138.681585 };

    await prefetchSuburb(point);

    expect(getCachedSuburb(point)).toBeNull();
    await prefetchSuburb(point);
    expect(fetchSuburbForPoint).toHaveBeenCalledTimes(1);
  });

  it('never fetches, and stays unresolved, when no Mapbox token is configured', async () => {
    mapboxAccessToken = '';
    const { prefetchSuburb, getCachedSuburb } = require('../suburbLookup');
    const point = { latitude: -34.818022, longitude: 138.681585 };

    await prefetchSuburb(point);

    expect(fetchSuburbForPoint).not.toHaveBeenCalled();
    expect(getCachedSuburb(point)).toBeUndefined();
  });
});
