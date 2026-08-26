const ORIGINAL_ENV = { ...process.env };

describe('env.backendApiBaseUrl', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    // env.ts reads process.env at module-evaluation time and caches the
    // result in a module-level export - reset the module registry so each
    // test re-evaluates it against this test's own process.env, not
    // whatever a previous test (or an earlier require in this file) left.
    jest.resetModules();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('adds a trailing slash when EXPO_PUBLIC_BACKEND_API_URL is missing one', async () => {
    process.env.EXPO_PUBLIC_BACKEND_API_URL = 'https://shotgun-api.example.com/api';
    const { env } = await import('../env');
    expect(env.backendApiBaseUrl).toBe('https://shotgun-api.example.com/api/');
  });

  it('leaves a URL that already has a trailing slash unchanged', async () => {
    process.env.EXPO_PUBLIC_BACKEND_API_URL = 'https://shotgun-api.example.com/api/';
    const { env } = await import('../env');
    expect(env.backendApiBaseUrl).toBe('https://shotgun-api.example.com/api/');
  });

  it('stays an empty string when unset, rather than becoming "/"', async () => {
    delete process.env.EXPO_PUBLIC_BACKEND_API_URL;
    const { env } = await import('../env');
    expect(env.backendApiBaseUrl).toBe('');
  });
});
