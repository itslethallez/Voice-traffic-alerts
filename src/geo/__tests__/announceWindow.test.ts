import {
  ANNOUNCE_MAX_AGE_MINUTES,
  ANNOUNCE_MAX_BEARING_DIFF_DEG,
  ANNOUNCE_MAX_DISTANCE_M,
  ANNOUNCE_MIN_DISTANCE_M,
  isBearingAnnounceable,
  isDistanceAnnounceable,
  isFreshEnoughToAnnounce,
} from '../announceWindow';

// These pin the exact boundary behaviour so Step 4's filtering engine
// can't silently redefine it later.
describe('isDistanceAnnounceable', () => {
  it('is inclusive at the 300m lower boundary', () => {
    expect(isDistanceAnnounceable(ANNOUNCE_MIN_DISTANCE_M)).toBe(true);
    expect(isDistanceAnnounceable(ANNOUNCE_MIN_DISTANCE_M - 0.001)).toBe(false);
  });

  it('is inclusive at the 2000m upper boundary', () => {
    expect(isDistanceAnnounceable(ANNOUNCE_MAX_DISTANCE_M)).toBe(true);
    expect(isDistanceAnnounceable(ANNOUNCE_MAX_DISTANCE_M + 0.001)).toBe(false);
  });

  it('is true in the middle of the range and false well outside it', () => {
    expect(isDistanceAnnounceable(1000)).toBe(true);
    expect(isDistanceAnnounceable(0)).toBe(false);
    expect(isDistanceAnnounceable(5000)).toBe(false);
  });
});

describe('isBearingAnnounceable', () => {
  it('is inclusive at the 45 degree boundary', () => {
    expect(isBearingAnnounceable(ANNOUNCE_MAX_BEARING_DIFF_DEG)).toBe(true);
    expect(isBearingAnnounceable(ANNOUNCE_MAX_BEARING_DIFF_DEG + 0.001)).toBe(false);
  });

  it('is true at 0 degrees and false past the boundary', () => {
    expect(isBearingAnnounceable(0)).toBe(true);
    expect(isBearingAnnounceable(90)).toBe(false);
  });
});

describe('isFreshEnoughToAnnounce', () => {
  it('is exclusive at the 30 minute boundary - exactly 30 minutes old is too stale', () => {
    expect(isFreshEnoughToAnnounce(ANNOUNCE_MAX_AGE_MINUTES)).toBe(false);
    expect(isFreshEnoughToAnnounce(ANNOUNCE_MAX_AGE_MINUTES - 0.001)).toBe(true);
  });

  it('is true for a fresh report and false for a stale one', () => {
    expect(isFreshEnoughToAnnounce(0)).toBe(true);
    expect(isFreshEnoughToAnnounce(60)).toBe(false);
  });
});
