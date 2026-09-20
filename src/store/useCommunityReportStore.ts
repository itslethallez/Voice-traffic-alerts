import { create } from 'zustand';
import type { SortedFacebookNotification } from '../notifications/sortFacebookNotification';

const MAX_PENDING_CANDIDATES = 20;

type CommunityReportStore = {
  candidates: SortedFacebookNotification[];
  addCandidate: (candidate: SortedFacebookNotification) => void;
  dismissCandidate: (sourceRef: string) => void;
};

export const useCommunityReportStore = create<CommunityReportStore>((set) => ({
  candidates: [],
  addCandidate: (candidate) =>
    set((state) => ({
      candidates: [
        candidate,
        ...state.candidates.filter((item) => item.sourceRef !== candidate.sourceRef),
      ].slice(0, MAX_PENDING_CANDIDATES),
    })),
  dismissCandidate: (sourceRef) =>
    set((state) => ({
      candidates: state.candidates.filter((candidate) => candidate.sourceRef !== sourceRef),
    })),
}));
