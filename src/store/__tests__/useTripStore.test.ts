const getDeviceId = jest.fn().mockResolvedValue('test-device-id');
jest.mock('../../config/deviceId', () => ({
  getDeviceId: () => getDeviceId(),
}));

const submitManualReport = jest.fn().mockResolvedValue({ id: 'remote-default-id' });
const deleteManualReport = jest.fn().mockResolvedValue(undefined);
const confirmManualReport = jest.fn().mockResolvedValue({ id: 'remote-default-id' });
jest.mock('../../api/backend/client', () => ({
  submitManualReport: (...args: unknown[]) => submitManualReport(...args),
  deleteManualReport: (...args: unknown[]) => deleteManualReport(...args),
  confirmManualReport: (...args: unknown[]) => confirmManualReport(...args),
}));

import { useTripStore, type ManualReport, type NearbyReport } from '../useTripStore';

const initialState = useTripStore.getState();

function makeManualReport(overrides: Partial<ManualReport> & Pick<ManualReport, 'id' | 'localKey' | 'createdAtMs'>): ManualReport {
  return {
    position: null,
    headingDeg: null,
    category: 'POLICE',
    subtype: null,
    lastConfirmedAtMs: overrides.createdAtMs,
    ...overrides,
  };
}

function makeNearbyReport(overrides: Partial<NearbyReport> & Pick<NearbyReport, 'id'>): NearbyReport {
  return {
    category: 'POLICE',
    subtype: null,
    position: { latitude: -34.9, longitude: 138.6 },
    headingDeg: null,
    createdAtMs: 1000,
    lastConfirmedAtMs: 1000,
    confirmedByThisDevice: false,
    ...overrides,
  };
}

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
    deleteManualReport.mockClear();
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
      category: 'POLICE',
      subtype: null,
    });
  });

  it('defaults to category POLICE with no subtype when called with no arguments', () => {
    useTripStore.getState().pushManualReport();

    const { manualReports } = useTripStore.getState();
    expect(manualReports[0].category).toBe('POLICE');
    expect(manualReports[0].subtype).toBeNull();
  });

  it('records the given category and subtype', async () => {
    useTripStore.getState().setDriverPosition({ latitude: -34.9, longitude: 138.6 }, 90, 60);

    useTripStore.getState().pushManualReport('POLICE', 'POLICE_VISIBLE');
    await flushMicrotasks();

    expect(useTripStore.getState().manualReports[0].category).toBe('POLICE');
    expect(useTripStore.getState().manualReports[0].subtype).toBe('POLICE_VISIBLE');
    expect(submitManualReport).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'POLICE', subtype: 'POLICE_VISIBLE' })
    );
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

  it('reconciles the local id with the backend id once the sync succeeds', async () => {
    // Regression test: without this, a report that finishes syncing before
    // the startup hydration fetch resolves keeps its local "manual-" id
    // forever, so setManualReports (which recognises already-synced reports
    // by id) can never tell the two apart and shows the report twice.
    submitManualReport.mockResolvedValueOnce({ id: 'remote-real-id' });
    useTripStore.getState().setDriverPosition({ latitude: -34.9, longitude: 138.6 }, 90, 60);

    useTripStore.getState().pushManualReport();
    const localId = useTripStore.getState().manualReports[0].id;
    await flushMicrotasks();

    const { manualReports } = useTripStore.getState();
    expect(manualReports).toHaveLength(1);
    expect(manualReports[0].id).toBe('remote-real-id');
    expect(manualReports[0].id).not.toBe(localId);
  });

  it('keeps localKey unchanged when the id is swapped for the backend id', async () => {
    // Regression test (Bugbot: "Id swap retriggers new-alert spotlight"):
    // manualReportToWazeAlert uses localKey, not id, as alert_id precisely
    // so that RadarMap's seenAlertIds tracking and React list keys don't
    // see this swap as a brand new alert.
    submitManualReport.mockResolvedValueOnce({ id: 'remote-real-id' });
    useTripStore.getState().setDriverPosition({ latitude: -34.9, longitude: 138.6 }, 90, 60);

    useTripStore.getState().pushManualReport();
    const localKey = useTripStore.getState().manualReports[0].localKey;
    await flushMicrotasks();

    expect(useTripStore.getState().manualReports[0].id).toBe('remote-real-id');
    expect(useTripStore.getState().manualReports[0].localKey).toBe(localKey);
  });

  it('does not resurrect a duplicate when hydration resolves after the id has already been reconciled', async () => {
    submitManualReport.mockResolvedValueOnce({ id: 'remote-real-id' });
    useTripStore.getState().setDriverPosition({ latitude: -34.9, longitude: 138.6 }, 90, 60);

    useTripStore.getState().pushManualReport();
    await flushMicrotasks();
    const syncedReport = useTripStore.getState().manualReports[0];

    // Simulate the startup hydration fetch resolving afterwards and already
    // including this same report under the backend's id.
    useTripStore.getState().setManualReports([
      makeManualReport({
        id: 'remote-real-id',
        localKey: 'remote-real-id',
        createdAtMs: syncedReport.createdAtMs,
        position: syncedReport.position,
        headingDeg: syncedReport.headingDeg,
      }),
    ]);

    expect(useTripStore.getState().manualReports).toHaveLength(1);
  });
});

describe('setManualReports', () => {
  beforeEach(() => {
    useTripStore.setState(initialState, true);
  });

  it('replaces old hydrated data with freshly-fetched data', () => {
    const first = [
      makeManualReport({
        id: 'remote-1',
        localKey: 'remote-1',
        createdAtMs: 100,
        position: { latitude: -34.9, longitude: 138.6 },
      }),
    ];
    useTripStore.getState().setManualReports(first);
    const second = [
      makeManualReport({
        id: 'remote-2',
        localKey: 'remote-2',
        createdAtMs: 200,
        position: { latitude: -34.9, longitude: 138.6 },
      }),
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
      makeManualReport({
        id: 'remote-1',
        localKey: 'remote-1',
        createdAtMs: localReport.createdAtMs - 1000,
        position: { latitude: -34.9, longitude: 138.6 },
      }),
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
      makeManualReport({
        id: localReport.id,
        localKey: localReport.localKey,
        createdAtMs: localReport.createdAtMs,
        position: localReport.position,
        headingDeg: localReport.headingDeg,
      }),
    ];

    useTripStore.getState().setManualReports(hydrated);

    expect(useTripStore.getState().manualReports).toHaveLength(1);
  });

  it('sorts the merged result newest-first', () => {
    useTripStore.setState({
      manualReports: [makeManualReport({ id: 'manual-old', localKey: 'manual-old', createdAtMs: 100 })],
    });
    const hydrated = [
      makeManualReport({ id: 'remote-1', localKey: 'remote-1', createdAtMs: 300 }),
      makeManualReport({ id: 'remote-2', localKey: 'remote-2', createdAtMs: 200 }),
    ];

    useTripStore.getState().setManualReports(hydrated);

    expect(useTripStore.getState().manualReports.map((r) => r.id)).toEqual([
      'remote-1',
      'remote-2',
      'manual-old',
    ]);
  });
});

describe('removeManualReport', () => {
  beforeEach(() => {
    useTripStore.setState(initialState, true);
    getDeviceId.mockClear();
    deleteManualReport.mockClear();
  });

  it('removes the report from local state immediately', () => {
    useTripStore.getState().pushManualReport();
    const { localKey } = useTripStore.getState().manualReports[0];

    useTripStore.getState().removeManualReport(localKey);

    expect(useTripStore.getState().manualReports).toHaveLength(0);
  });

  it('does nothing if the localKey is not found', () => {
    useTripStore.getState().pushManualReport();

    useTripStore.getState().removeManualReport('not-a-real-key');

    expect(useTripStore.getState().manualReports).toHaveLength(1);
  });

  it('deletes an already-synced report from the backend', async () => {
    useTripStore.getState().setManualReports([
      makeManualReport({ id: 'remote-1', localKey: 'remote-1', createdAtMs: 100 }),
    ]);

    useTripStore.getState().removeManualReport('remote-1');
    await flushMicrotasks();

    expect(deleteManualReport).toHaveBeenCalledWith({ id: 'remote-1', deviceId: 'test-device-id' });
  });

  it('does not call the backend for a report that has not synced yet, but deletes it once its sync resolves', async () => {
    // Regression: deleting a report the instant after tapping "Report",
    // before its background submitManualReport call has resolved, must not
    // let that now-orphaned sync silently recreate the report the driver
    // just asked to remove.
    useTripStore.getState().setDriverPosition({ latitude: -34.9, longitude: 138.6 }, 90, 60);
    submitManualReport.mockResolvedValueOnce({ id: 'remote-real-id' });

    useTripStore.getState().pushManualReport();
    const { localKey } = useTripStore.getState().manualReports[0];
    useTripStore.getState().removeManualReport(localKey);

    expect(deleteManualReport).not.toHaveBeenCalled();

    await flushMicrotasks();

    expect(deleteManualReport).toHaveBeenCalledWith({ id: 'remote-real-id', deviceId: 'test-device-id' });
    expect(useTripStore.getState().manualReports).toHaveLength(0);
  });
});

describe('confirmNearbyReport', () => {
  beforeEach(() => {
    useTripStore.setState(initialState, true);
    getDeviceId.mockClear();
    confirmManualReport.mockClear();
  });

  it('optimistically marks the report confirmed by this device', () => {
    useTripStore.getState().setNearbyReports([makeNearbyReport({ id: 'remote-1' })]);

    useTripStore.getState().confirmNearbyReport('remote-1');

    expect(useTripStore.getState().nearbyReports[0].confirmedByThisDevice).toBe(true);
  });

  it('resets the report\'s lastConfirmedAtMs to now', () => {
    useTripStore.getState().setNearbyReports([makeNearbyReport({ id: 'remote-1', lastConfirmedAtMs: 1000 })]);

    useTripStore.getState().confirmNearbyReport('remote-1');

    expect(useTripStore.getState().nearbyReports[0].lastConfirmedAtMs).toBeGreaterThan(1000);
  });

  it('syncs the confirmation to the backend in the background', async () => {
    useTripStore.getState().setNearbyReports([makeNearbyReport({ id: 'remote-1' })]);

    useTripStore.getState().confirmNearbyReport('remote-1');
    await flushMicrotasks();

    expect(confirmManualReport).toHaveBeenCalledWith({ id: 'remote-1', deviceId: 'test-device-id' });
  });

  it('does nothing if the report is not found', () => {
    useTripStore.getState().setNearbyReports([makeNearbyReport({ id: 'remote-1' })]);

    useTripStore.getState().confirmNearbyReport('not-a-real-id');

    expect(confirmManualReport).not.toHaveBeenCalled();
    expect(useTripStore.getState().nearbyReports[0].confirmedByThisDevice).toBe(false);
  });

  it('does not call the backend again for a report already confirmed by this device', () => {
    useTripStore.getState().setNearbyReports([makeNearbyReport({ id: 'remote-1', confirmedByThisDevice: true })]);

    useTripStore.getState().confirmNearbyReport('remote-1');

    expect(confirmManualReport).not.toHaveBeenCalled();
  });
});

describe('setNearbyReports', () => {
  beforeEach(() => {
    useTripStore.setState(initialState, true);
  });

  it('replaces nearbyReports wholesale', () => {
    useTripStore.getState().setNearbyReports([makeNearbyReport({ id: 'remote-1' })]);

    useTripStore.getState().setNearbyReports([makeNearbyReport({ id: 'remote-2' })]);

    expect(useTripStore.getState().nearbyReports.map((r) => r.id)).toEqual(['remote-2']);
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
