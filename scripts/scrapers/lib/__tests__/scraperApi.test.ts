jest.mock('../env.js', () => ({ readEnvValue: () => 'test-key' }));
const { fetchViaScraperApi } = require('../scraperApi.js');

const reply = (status: number, body = 'x') => ({ ok: status < 300, status, text: async () => body });

describe('fetchViaScraperApi', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const params = (call: number) => new URL(fetchMock.mock.calls[call][0]).searchParams;

  it('routes through Australian IPs on the standard pool first', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, '<html>'));
    await expect(fetchViaScraperApi('https://example.gov.au')).resolves.toBe('<html>');
    expect(params(0).get('country_code')).toBe('au');
    expect(params(0).get('premium')).toBeNull();
  });

  it('alternates standard and premium for each round on 500', async () => {
    fetchMock.mockResolvedValue(reply(500, 'Request failed'));
    await expect(fetchViaScraperApi('https://example.gov.au', { rounds: 2 })).rejects.toThrow('500');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect([0, 1, 2, 3].map((call) => params(call).get('premium'))).toEqual([null, 'true', null, 'true']);
  });

  it('tries premium first when preferred', async () => {
    fetchMock.mockResolvedValueOnce(reply(500)).mockResolvedValueOnce(reply(200, 'ok'));
    await expect(fetchViaScraperApi('https://example.gov.au', { preferredPremium: true })).resolves.toBe('ok');
    expect(params(0).get('premium')).toBe('true');
    expect(params(1).get('premium')).toBeNull();
  });

  it('succeeds on a later standard retry', async () => {
    fetchMock.mockResolvedValueOnce(reply(500)).mockResolvedValueOnce(reply(200, 'ok'));
    await expect(fetchViaScraperApi('https://example.gov.au')).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops immediately on 401 (bad key)', async () => {
    fetchMock.mockResolvedValue(reply(401, 'Unauthorized'));
    await expect(fetchViaScraperApi('https://example.gov.au')).rejects.toThrow('401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
