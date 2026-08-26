const getDeviceId = jest.fn().mockResolvedValue('test-device-id');
jest.mock('../../config/deviceId', () => ({
  getDeviceId: () => getDeviceId(),
}));

const submitManualReport = jest.fn().mockResolvedValue(undefined);
jest.mock('../../api/backend/client', () => ({
  submitManualReport: (...args: unknown[]) => submitManualReport(...args),
}));

import { useTripStore } from '../useTripStore';

const initialState = useTripStore.getState();

/** pushManualReport's backend sync is fire-and-forget - flush the
 * microtask queue so its awaited getDeviceId()/submitManualReport() calls
 * resolve before a test asserts on them. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('pushManualReport', () => {
  beforeEach(() => {
    useTripStore.setState(initialState, true);
    getDeviceId.mockClear();
    submitManualReport.mockClear();
  });

  it('prepends a new report carrying the current driver position', () => {
    useTripStore.getState().setDriverPosition({ latitude: -34.9, longitude: 138.6 }, 90, 60);

    useTripStore.getState().pushManualReport();

    const { manualReports } = useTripStore.getState();
    expect(manualReports).toHaveLength(1);
    expect(manualReports[0].position).toEqual({ latitude: -34.9, longitude: 138.6 });
    expect(typeof manualReports[0].id).toBe('string');
    expect(typeof manualReports[0].createdAtMs).toBe('number');
  });

  it('records a null position when the driver position is not yet known', () => {
    useTripStore.getState().pushManualReport();

    expect(useTripStore.getState().manualReports[0].position).toBeNull();
  });

  it('records the current driver heading', () => {
    useTripStore.getState().setDriverPosition({ latitude: -34.9, longitude: 138.6 }, 90, 60);

    useTripStore.getState().pushManualReport();

    expect(useTripStore.getState().manualReports[0].headingDeg).toBe(90);
  });

  it('records a null heading when the driver position is not yet known', () => {
    useTripStore.getState().pushManualReport();

    expect(useTripStore.getState().manualReports[0].headingDeg).toBeNull();
  });

  it('prepends (newest first) and gives each report a distinct id', () => {
    useTripStore.getState().pushManualReport();
    useTripStore.getState().pushManualReport();

    const { manualReports } = useTripStore.getState();
    expect(manualReports).toHaveLength(2);
    expect(manualReports[0].id).not.toBe(manualReports[1].id);
  });

  it('syncs to the backend in the background when the driver position is known', async () => {
    useTripStore.getState().setDriverPosition({ latitude: -34.9, longitude: 138.6 }, 90, 60);

    useTripStore.getState().pushManualReport();
    await flushMicrotasks();

    expect(getDeviceId).toHaveBeenCalledTimes(1);
    expect(submitManualReport).toHaveBeenCalledWith({
      deviceId: 'test-device-id',
      position: { latitude: -34.9, longitude: 138.6 },
      headingDeg: 90,
    });
  });

  it('does not attempt to sync when the driver position is not yet known', async () => {
    useTripStore.getState().pushManualReport();
    await flushMicrotasks();

    expect(submitManualReport).not.toHaveBeenCalled();
  });

  it('still keeps the local report even if the background sync fails', async () => {
    submitManualReport.mockRejectedValueOnce(new Error('network down'));
    useTripStore.getState().setDriverPosition({ latitude: -34.9, longitude: 138.6 }, 90, 60);

    useTripStore.getState().pushManualReport();
    await flushMicrotasks();

    expect(useTripStore.getState().manualReports).toHaveLength(1);
  });
});

describe('setManualReports', () => {
  beforeEach(() => {
    useTripStore.setState(initialState, true);
  });

  it('replaces old hydrated data with freshly-fetched data', () => {
    const first = [
      { id: 'remote-1', createdAtMs: 100, position: { latitude: -34.9, longitude: 138.6 }, headingDeg: null },
    ];
    useTripStore.getState().setManualReports(first);
    const second = [
      { id: 'remote-2', createdAtMs: 200, position: { latitude: -34.9, longitude: 138.6 }, headingDeg: null },
    ];

    useTripStore.getState().setManualReports(second);

    expect(useTripStore.getState().manualReports).toEqual(second);
  });

  it('preserves a locally-pushed report not yet reflected in the hydrated list, instead of wiping it', () => {
    // Regression test: the driver taps "Report police" (pushManualReport)
    // right as the startup hydration fetch is still in flight - the
    // fetched snapshot predates that tap, so it won't include it, but the
    // optimistic local entry must survive the merge rather than being
    // overwritten away.
    useTripStore.getState().pushManualReport();
    const localReport = useTripStore.getState().manualReports[0];
    const hydrated = [
      {
        id: 'remote-1',
        createdAtMs: localReport.createdAtMs - 1000,
        position: { latitude: -34.9, longitude: 138.6 },
        headingDeg: null,
      },
    ];

    useTripStore.getState().setManualReports(hydrated);

    const { manualReports } = useTripStore.getState();
    expect(manualReports).toHaveLength(2);
    expect(manualReports.some((r) => r.id === localReport.id)).toBe(true);
    expect(manualReports.some((r) => r.id === 'remote-1')).toBe(true);
  });

  it('does not duplicate a local report once the hydrated list actually includes it', () => {
    useTripStore.getState().pushManualReport();
    const localReport = useTripStore.getState().manualReports[0];
    const hydrated = [
      {
        id: localReport.id,
        createdAtMs: localReport.createdAtMs,
        position: localReport.position,
        headingDeg: localReport.headingDeg,
      },
    ];

    useTripStore.getState().setManualReports(hydrated);

    expect(useTripStore.getState().manualReports).toHaveLength(1);
  });

  it('sorts the merged result newest-first', () => {
    useTripStore.setState({
      manualReports: [{ id: 'manual-old', createdAtMs: 100, position: null, headingDeg: null }],
    });
    const hydrated = [
      { id: 'remote-1', createdAtMs: 300, position: null, headingDeg: null },
      { id: 'remote-2', createdAtMs: 200, position: null, headingDeg: null },
    ];

    useTripStore.getState().setManualReports(hydrated);

    expect(useTripStore.getState().manualReports.map((r) => r.id)).toEqual([
      'remote-1',
      'remote-2',
      'manual-old',
    ]);
  });
});

describe('tripStartedAtMs', () => {
  beforeEach(() => {
    useTripStore.setState(initialState, true);
  });

  it('starts null', () => {
    expect(useTripStore.getState().tripStartedAtMs).toBeNull();
  });

  it('is set by setTripStartedAtMs', () => {
    useTripStore.getState().setTripStartedAtMs(12345);
    expect(useTripStore.getState().tripStartedAtMs).toBe(12345);
  });
});
