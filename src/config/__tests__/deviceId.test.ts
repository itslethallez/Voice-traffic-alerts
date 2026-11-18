const storage = new Map<string, string>();
const getItem = jest.fn((key: string) => Promise.resolve(storage.get(key) ?? null));
const setItem = jest.fn((key: string, value: string) => {
  storage.set(key, value);
  return Promise.resolve();
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: (...args: [string]) => getItem(...args), setItem: (...args: [string, string]) => setItem(...args) },
}));

let nextUuid = 0;
const randomUUID = jest.fn(() => `generated-uuid-${++nextUuid}`);
jest.mock('expo-crypto', () => ({
  randomUUID: () => randomUUID(),
}));

describe('getDeviceId', () => {
  beforeEach(() => {
    storage.clear();
    getItem.mockClear();
    setItem.mockClear();
    randomUUID.mockClear();
    nextUuid = 0;
    // deviceId.ts caches the id in a module-level variable - reset the
    // module itself between tests so each one starts from a clean slate,
    // not whatever a previous test already cached in memory.
    jest.resetModules();
  });

  it('generates and persists a new id when none is stored', async () => {
    const { getDeviceId } = await import('../deviceId');
    const id = await getDeviceId();
    expect(id).toBe('generated-uuid-1');
    expect(setItem).toHaveBeenCalledWith('voice-traffic-alerts/deviceId', 'generated-uuid-1');
  });

  it('returns the previously stored id instead of generating a new one', async () => {
    storage.set('voice-traffic-alerts/deviceId', 'existing-id');
    const { getDeviceId } = await import('../deviceId');
    const id = await getDeviceId();
    expect(id).toBe('existing-id');
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it('caches the id in memory - only reads AsyncStorage once across repeated calls', async () => {
    const { getDeviceId } = await import('../deviceId');
    await getDeviceId();
    await getDeviceId();
    expect(getItem.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
