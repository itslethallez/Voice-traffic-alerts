/**
 * Feed watchdog: a dead data feed must notify the owner within hours, not
 * sit failing silently for a month (police notices failed daily from
 * 13 Oct with nobody noticing). Run by .github/workflows/feed-health.yml
 * after every feed run and every 6 hours.
 *
 * For each feed workflow it checks three things via the GitHub API:
 *   - the workflow is still enabled (GitHub disables scheduled workflows
 *     after 60 days without repo activity),
 *   - the latest completed run didn't fail,
 *   - a run succeeded within the feed's max age (catches a schedule that
 *     silently stopped firing).
 * Unhealthy -> opens a "Feed down: <feed>" issue (label feed-health)
 * assigned to the owner, or comments on the open one when there's a new
 * failed run. Healthy again -> comments and closes it. Exits non-zero
 * while any feed is unhealthy so the watchdog run itself goes red too.
 *
 * Env (set by the workflow): GITHUB_TOKEN, GITHUB_REPOSITORY,
 * FEED_ALERT_ASSIGNEE (optional, defaults to the repo owner).
 * Dependency-free on purpose (plain node, no install step).
 */

const FEEDS = [
  { workflow: 'refresh-police-notices.yml', name: 'Police mobile-camera notices', maxAgeHours: 30 },
  { workflow: 'refresh-fixed-cameras.yml', name: 'Fixed camera dataset', maxAgeHours: 8 * 24 + 6 },
  { workflow: 'refresh-waze-alerts.yml', name: 'Waze alert mirror', maxAgeHours: 24 },
];

const LABEL = 'feed-health';
const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);
const HOUR_MS = 60 * 60 * 1000;

/**
 * Pure health verdict for one feed.
 * @param {{ maxAgeHours: number }} feed
 * @param {{ state: string, latestRun: { id: number, conclusion: string, created_at: string, html_url: string } | null, latestSuccess: { created_at: string } | null }} status
 * @param {number} nowMs
 */
function evaluateFeed(feed, status, nowMs) {
  const reasons = [];
  if (status.state !== 'active') {
    reasons.push(`workflow is ${status.state} - scheduled runs have stopped (re-enable it in the Actions tab)`);
  }
  if (status.latestRun && FAILED_CONCLUSIONS.has(status.latestRun.conclusion)) {
    reasons.push(`latest run ${status.latestRun.conclusion} at ${status.latestRun.created_at}: ${status.latestRun.html_url}`);
  }
  if (!status.latestSuccess) {
    reasons.push('no successful run on record');
  } else {
    const ageHours = (nowMs - Date.parse(status.latestSuccess.created_at)) / HOUR_MS;
    if (ageHours > feed.maxAgeHours) {
      reasons.push(
        `last successful run was ${Math.round(ageHours)} h ago (${status.latestSuccess.created_at}), limit ${feed.maxAgeHours} h`
      );
    }
  }
  return { healthy: reasons.length === 0, reasons };
}

function issueTitle(feed) {
  return `Feed down: ${feed.name}`;
}

/** Hidden marker so the same failed run is only reported once. */
function runMarker(status) {
  return `<!-- feed-health run:${status.latestRun ? status.latestRun.id : 'none'} state:${status.state} -->`;
}

function issueBody(feed, verdict, status, assignee) {
  return [
    `@${assignee} the **${feed.name}** feed (\`${feed.workflow}\`) is unhealthy, so the app is serving stale or missing data for it:`,
    '',
    ...verdict.reasons.map((reason) => `- ${reason}`),
    '',
    'This issue closes itself once the feed succeeds again.',
    runMarker(status),
  ].join('\n');
}

function createGitHubClient(token, repo) {
  async function api(method, path, body) {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok && !(method === 'POST' && path.endsWith('/labels') && response.status === 422)) {
      throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    return response.status === 204 ? null : response.json();
  }

  return {
    async getStatus(feed) {
      const base = `/repos/${repo}/actions/workflows/${feed.workflow}`;
      const [workflow, completed, succeeded] = await Promise.all([
        api('GET', base),
        api('GET', `${base}/runs?status=completed&per_page=10`),
        api('GET', `${base}/runs?status=success&per_page=1`),
      ]);
      const latestRun = completed.workflow_runs.find((run) => run.conclusion !== 'cancelled') ?? null;
      return { state: workflow.state, latestRun, latestSuccess: succeeded.workflow_runs[0] ?? null };
    },
    ensureLabel: () =>
      api('POST', `/repos/${repo}/labels`, { name: LABEL, color: 'd73a4a', description: 'A data feed is down or stale' }),
    findOpenIssue: async (title) =>
      (await api('GET', `/repos/${repo}/issues?state=open&labels=${LABEL}&per_page=100`)).find(
        (issue) => issue.title === title
      ) ?? null,
    listCommentBodies: async (number) =>
      (await api('GET', `/repos/${repo}/issues/${number}/comments?per_page=100`)).map((comment) => comment.body),
    createIssue: (title, body, assignee) =>
      api('POST', `/repos/${repo}/issues`, { title, body, labels: [LABEL], assignees: [assignee] }),
    comment: (number, body) => api('POST', `/repos/${repo}/issues/${number}/comments`, { body }),
    close: (number) => api('PATCH', `/repos/${repo}/issues/${number}`, { state: 'closed', state_reason: 'completed' }),
  };
}

async function checkFeed(client, feed, assignee, nowMs) {
  const status = await client.getStatus(feed);
  const verdict = evaluateFeed(feed, status, nowMs);
  const title = issueTitle(feed);
  const openIssue = await client.findOpenIssue(title);

  if (verdict.healthy) {
    console.log(`[feed-health] ${feed.name}: ok (last success ${status.latestSuccess.created_at})`);
    if (openIssue) {
      await client.comment(openIssue.number, `Recovered: successful run at ${status.latestSuccess.created_at}.`);
      await client.close(openIssue.number);
      console.log(`[feed-health] ${feed.name}: closed #${openIssue.number}`);
    }
    return verdict;
  }

  console.log(`[feed-health] ${feed.name}: UNHEALTHY - ${verdict.reasons.join('; ')}`);
  const body = issueBody(feed, verdict, status, assignee);
  if (!openIssue) {
    const created = await client.createIssue(title, body, assignee);
    console.log(`[feed-health] ${feed.name}: opened #${created.number}`);
  } else {
    const marker = runMarker(status);
    const seen = openIssue.body?.includes(marker) || (await client.listCommentBodies(openIssue.number)).some((b) => b.includes(marker));
    if (!seen) {
      await client.comment(openIssue.number, body);
      console.log(`[feed-health] ${feed.name}: updated #${openIssue.number}`);
    }
  }
  return verdict;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY must be set');
  const assignee = process.env.FEED_ALERT_ASSIGNEE || repo.split('/')[0];
  const client = createGitHubClient(token, repo);
  await client.ensureLabel();

  let unhealthy = 0;
  for (const feed of FEEDS) {
    const verdict = await checkFeed(client, feed, assignee, Date.now());
    if (!verdict.healthy) unhealthy += 1;
  }
  if (unhealthy > 0) {
    console.error(`[feed-health] ${unhealthy} feed(s) unhealthy`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[feed-health] watchdog failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { FEEDS, evaluateFeed, checkFeed, issueTitle };
