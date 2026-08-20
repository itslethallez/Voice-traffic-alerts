import { useTripStore } from '../useTripStore';

const initialState = useTripStore.getState();

describe('pushManualReport', () => {
  beforeEach(() => {
    useTripStore.setState(initialState, true);
  });

  it('prepends a new report carrying the current driver position', () => {
    useTripStore.getState().setDriverPosition({ latitude: -34.9, longitude: 138.6 }, 90);

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

  it('prepends (newest first) and gives each report a distinct id', () => {
    useTripStore.getState().pushManualReport();
    useTripStore.getState().pushManualReport();

    const { manualReports } = useTripStore.getState();
    expect(manualReports).toHaveLength(2);
    expect(manualReports[0].id).not.toBe(manualReports[1].id);
  });
});
