const { evaluateFeed, checkFeed, issueTitle } = require('../checkFeedHealth.js');

const NOW = Date.parse('2026-11-18T00:00:00Z');
const daily = { workflow: 'refresh-police-notices.yml', name: 'Police mobile-camera notices', maxAgeHours: 30 };
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const run = (id: number, conclusion: string, h: number) => ({
  id,
  conclusion,
  created_at: hoursAgo(h),
  updated_at: hoursAgo(h),
  html_url: `https://github.com/o/r/actions/runs/${id}`,
});

describe('evaluateFeed', () => {
  it('is healthy when the latest run succeeded recently', () => {
    const ok = run(1, 'success', 5);
    expect(evaluateFeed(daily, { state: 'active', latestRun: ok, latestSuccess: ok }, NOW).healthy).toBe(true);
  });

  it('flags a failed latest run immediately, even if the last success is recent', () => {
    const verdict = evaluateFeed(
      daily,
      { state: 'active', latestRun: run(2, 'failure', 1), latestSuccess: run(1, 'success', 25) },
      NOW
    );
    expect(verdict.healthy).toBe(false);
    expect(verdict.reasons[0]).toContain('latest run failure');
  });

  it('ignores a failure that finished before a later-finishing success', () => {
    const failedEarly = { ...run(3, 'failure', 1), updated_at: hoursAgo(0.9) };
    const succeededLater = { ...run(2, 'success', 2), updated_at: hoursAgo(0.5) };
    expect(
      evaluateFeed(daily, { state: 'active', latestRun: failedEarly, latestSuccess: succeededLater }, NOW).healthy
    ).toBe(true);
  });

  it('flags a feed with no success inside its max age (schedule stopped firing)', () => {
    const old = run(1, 'success', 31);
    const verdict = evaluateFeed(daily, { state: 'active', latestRun: old, latestSuccess: old }, NOW);
    expect(verdict.healthy).toBe(false);
    expect(verdict.reasons[0]).toContain('31 h ago');
  });

  it('flags a disabled workflow and a feed that never succeeded', () => {
    const verdict = evaluateFeed(
      daily,
      { state: 'disabled_inactivity', latestRun: run(2, 'failure', 2), latestSuccess: null },
      NOW
    );
    expect(verdict.reasons).toHaveLength(3);
  });
});

describe('checkFeed', () => {
  const makeClient = (status: object, openIssue: object | null, comments: string[] = []) => ({
    getStatus: jest.fn().mockResolvedValue(status),
    findOpenIssue: jest.fn().mockResolvedValue(openIssue),
    listCommentBodiesSince: jest.fn().mockResolvedValue(comments),
    createIssue: jest.fn().mockResolvedValue({ number: 7 }),
    comment: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(null),
  });
  const failing = { state: 'active', latestRun: run(9, 'failure', 1), latestSuccess: run(1, 'success', 40) };

  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('opens an assigned issue for a newly dead feed', async () => {
    const client = makeClient(failing, null);
    await checkFeed(client, daily, 'owner', NOW);
    expect(client.createIssue).toHaveBeenCalledWith(issueTitle(daily), expect.stringContaining('@owner'), 'owner');
  });

  it('re-pings at most once a day while the feed stays down', async () => {
    const stale = makeClient(failing, { number: 7, body: '', created_at: hoursAgo(48) }, []);
    await checkFeed(stale, daily, 'owner', NOW);
    expect(stale.comment).toHaveBeenCalledTimes(1);

    const pinged = makeClient(failing, { number: 7, body: '', created_at: hoursAgo(48) }, ['x <!-- feed-health -->']);
    await checkFeed(pinged, daily, 'owner', NOW);
    expect(pinged.comment).not.toHaveBeenCalled();

    const fresh = makeClient(failing, { number: 7, body: '', created_at: hoursAgo(2) }, []);
    await checkFeed(fresh, daily, 'owner', NOW);
    expect(fresh.comment).not.toHaveBeenCalled();
  });

  it('closes the issue when the feed recovers', async () => {
    const ok = run(10, 'success', 1);
    const client = makeClient({ state: 'active', latestRun: ok, latestSuccess: ok }, { number: 7, body: '' });
    await checkFeed(client, daily, 'owner', NOW);
    expect(client.close).toHaveBeenCalledWith(7);
  });
});
