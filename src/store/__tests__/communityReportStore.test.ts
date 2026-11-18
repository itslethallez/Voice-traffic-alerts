import { useCommunityReportStore } from '../useCommunityReportStore';

const candidate = (sourceRef: string, decision: 'eligible' | 'review' = 'review') => ({
  source: 'facebook_notification' as const,
  sourceRef,
  capturedAtMs: 1_700_000_000_000,
  category: 'HAZARD' as const,
  subtype: null,
  locationText: 'Port Road',
  direction: null,
  summary: 'HAZARD · Port Road',
  confidence: decision === 'eligible' ? 0.9 : 0.7,
  decision,
});

describe('useCommunityReportStore', () => {
  beforeEach(() => {
    useCommunityReportStore.setState({ candidates: [] });
  });

  it('prepends new candidates and deduplicates notification updates', () => {
    const store = useCommunityReportStore.getState();
    store.addCandidate(candidate('notification|1'));
    store.addCandidate(candidate('notification|2', 'eligible'));
    store.addCandidate(candidate('notification|1', 'eligible'));

    expect(useCommunityReportStore.getState().candidates.map((item) => item.sourceRef)).toEqual([
      'notification|1',
      'notification|2',
    ]);
    expect(useCommunityReportStore.getState().candidates[0].decision).toBe('eligible');
  });

  it('dismisses a candidate by source reference', () => {
    useCommunityReportStore.getState().addCandidate(candidate('notification|1'));
    useCommunityReportStore.getState().dismissCandidate('notification|1');

    expect(useCommunityReportStore.getState().candidates).toEqual([]);
  });
});
