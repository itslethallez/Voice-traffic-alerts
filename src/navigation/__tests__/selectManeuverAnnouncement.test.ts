import { MANEUVER_CHECKPOINTS_M, selectManeuverAnnouncement, type ManeuverCheckpoint } from '../selectManeuverAnnouncement';

function firedMap(entries: [number, ManeuverCheckpoint[]][]): Map<number, Set<ManeuverCheckpoint>> {
  return new Map(entries.map(([step, checkpoints]) => [step, new Set(checkpoints)]));
}

describe('selectManeuverAnnouncement', () => {
  it('returns null when farther than every checkpoint', () => {
    const result = selectManeuverAnnouncement({
      distanceToNextManeuverM: 900,
      stepIndex: 0,
      firedCheckpoints: firedMap([]),
    });
    expect(result).toBeNull();
  });

  it('fires the outermost checkpoint first even if closer ones would also match', () => {
    const result = selectManeuverAnnouncement({
      distanceToNextManeuverM: 50,
      stepIndex: 0,
      firedCheckpoints: firedMap([]),
    });
    expect(result).toEqual({ stepIndex: 0, checkpoint: 500 });
  });

  it('skips a checkpoint already fired for this step and offers the next one', () => {
    const result = selectManeuverAnnouncement({
      distanceToNextManeuverM: 150,
      stepIndex: 0,
      firedCheckpoints: firedMap([[0, [500]]]),
    });
    expect(result).toEqual({ stepIndex: 0, checkpoint: 200 });
  });

  it('never re-offers the last checkpoint once all have fired', () => {
    const result = selectManeuverAnnouncement({
      distanceToNextManeuverM: 10,
      stepIndex: 0,
      firedCheckpoints: firedMap([[0, [...MANEUVER_CHECKPOINTS_M]]]),
    });
    expect(result).toBeNull();
  });

  it('tracks fired checkpoints independently per step', () => {
    // Step 0 already has both 500 and 200 fired - if that history leaked
    // into step 1, this would wrongly return the 200 (or null) instead of
    // the correct farthest-first 500.
    const result = selectManeuverAnnouncement({
      distanceToNextManeuverM: 150,
      stepIndex: 1,
      firedCheckpoints: firedMap([[0, [500, 200]]]),
    });
    expect(result).toEqual({ stepIndex: 1, checkpoint: 500 });
  });
});
