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

  it('retries the standard pool on 500 before a final premium attempt', async () => {
    fetchMock.mockResolvedValue(reply(500, 'Request failed'));
    await expect(fetchViaScraperApi('https://example.gov.au', { standardAttempts: 3 })).rejects.toThrow('500');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(params(3).get('premium')).toBe('true');
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
