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
 * assigned to the owner, then re-pings on it at most once a day while the
 * feed stays down (a 5-minute feed must not ping every run). Healthy again -> comments and closes it. Exits non-zero
 * while any feed is unhealthy so the watchdog run itself goes red too.
 *
 * It also probes live services (LIVE_CHECKS - the Valhalla routing
 * server) the same way, as "Service down: <name>" issues.
 *
 * Env (set by the workflow): GITHUB_TOKEN, GITHUB_REPOSITORY,
 * FEED_ALERT_ASSIGNEE (optional, defaults to the repo owner),
 * VALHALLA_URL + VALHALLA_SHARED_SECRET (the Valhalla probe is skipped,
 * with a log line, until both are set).
 * Dependency-free on purpose (plain node, no install step).
 */

const FEEDS = [
  { workflow: 'refresh-police-notices.yml', name: 'Police mobile-camera notices', maxAgeHours: 30 },
  { workflow: 'refresh-fixed-cameras.yml', name: 'Fixed camera dataset', maxAgeHours: 8 * 24 + 6 },
  { workflow: 'refresh-waze-alerts.yml', name: 'Waze alert mirror', maxAgeHours: 24 },
  // Weekly OpenStreetMap rebuild of the Valhalla road map (Monday 03:00
  // Adelaide); a week plus slack, like the fixed-camera dataset.
  { workflow: 'refresh-valhalla.yml', name: 'Valhalla road map update', maxAgeHours: 8 * 24 + 6 },
];

/**
 * Live services probed directly rather than through a workflow's runs.
 * The Valhalla routing server (infra/valhalla/) answers road matching
 * first; if it dies, server/api/road/forward-route.ts falls back to Mapbox
 * and nobody would notice except on the Mapbox bill - so it gets an issue
 * like a dead feed. Probe: /status, then a real route on Sir Donald
 * Bradman Drive whose road name must come back, inside the 1.5s the
 * server waits before falling back.
 */
const LIVE_CHECKS = [{ name: 'Valhalla routing server', probe: probeValhalla }];

const VALHALLA_PROBE_TIMEOUT_MS = 10_000;
const VALHALLA_SLOW_MS = 1_500;

/**
 * @param {{ VALHALLA_URL?: string, VALHALLA_SHARED_SECRET?: string }} env
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{ configured: boolean, healthy: boolean, reasons: string[] }>}
 */
async function probeValhalla(env, fetchImpl = fetch) {
  const base = (env.VALHALLA_URL || '').replace(/\/$/, '');
  if (!base || !env.VALHALLA_SHARED_SECRET) return { configured: false, healthy: true, reasons: [] };
  const headers = { 'content-type': 'application/json', 'x-shotgun-valhalla-secret': env.VALHALLA_SHARED_SECRET };
  const call = async (path, body) => {
    const started = Date.now();
    const response = await fetchImpl(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(VALHALLA_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return { json: await response.json(), ms: Date.now() - started };
  };
  const unhealthy = (reason) => ({ configured: true, healthy: false, reasons: [reason] });
  try {
    await call('/status');
    // Sir Donald Bradman Drive eastbound, ~1.3km - the Stage 3 drive-test road.
    const route = await call('/route', {
      locations: [
        { lat: -34.93238, lon: 138.54441, heading: 86, heading_tolerance: 45 },
        { lat: -34.93238, lon: 138.55743 },
      ],
      costing: 'auto',
      directions_type: 'none',
    });
    const shape = route.json.trip && route.json.trip.legs[0] && route.json.trip.legs[0].shape;
    if (!shape) return unhealthy('test route on Sir Donald Bradman Drive returned no trip');
    const trace = await call('/trace_attributes', {
      encoded_polyline: shape,
      costing: 'auto',
      shape_match: 'edge_walk',
      filters: { attributes: ['edge.names'], action: 'include' },
    });
    const names = (trace.json.edges || []).flatMap((edge) => edge.names || []);
    if (!names.includes('Sir Donald Bradman Drive')) {
      return unhealthy(`test route came back without its road name (got: ${names.join(', ') || 'none'})`);
    }
    if (route.ms + trace.ms > VALHALLA_SLOW_MS) {
      return unhealthy(
        `test route took ${route.ms + trace.ms}ms - over the ${VALHALLA_SLOW_MS}ms the server waits before falling back to Mapbox`
      );
    }
    return { configured: true, healthy: true, reasons: [] };
  } catch (error) {
    return unhealthy(`${base} unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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
  // Runs are listed by start time, so with overlapping runs the "latest"
  // can be a failure that finished before a later-finishing success.
  const supersededBySuccess =
    status.latestRun &&
    status.latestSuccess &&
    Date.parse(status.latestSuccess.updated_at) >= Date.parse(status.latestRun.updated_at);
  if (status.latestRun && FAILED_CONCLUSIONS.has(status.latestRun.conclusion) && !supersededBySuccess) {
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

const REMINDER_INTERVAL_MS = 24 * HOUR_MS;
/** Hidden marker identifying watchdog-written issue bodies and comments. */
const MARKER = '<!-- feed-health -->';

function issueBody(feed, verdict, status, assignee) {
  return [
    `@${assignee} the **${feed.name}** feed (\`${feed.workflow}\`) is unhealthy, so the app is serving stale or missing data for it:`,
    '',
    ...verdict.reasons.map((reason) => `- ${reason}`),
    '',
    'This issue closes itself once the feed succeeds again.',
    MARKER,
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
    listCommentBodiesSince: async (number, sinceIso) =>
      (await api('GET', `/repos/${repo}/issues/${number}/comments?since=${encodeURIComponent(sinceIso)}&per_page=100`)).map(
        (comment) => comment.body
      ),
    createIssue: (title, body, assignee) =>
      api('POST', `/repos/${repo}/issues`, { title, body, labels: [LABEL], assignees: [assignee] }),
    comment: (number, body) => api('POST', `/repos/${repo}/issues/${number}/comments`, { body }),
    close: (number) => api('PATCH', `/repos/${repo}/issues/${number}`, { state: 'closed', state_reason: 'completed' }),
  };
}

/** Opens / re-pings (at most daily) / closes the issue for one feed or live check. */
async function syncIssue(client, { title, label, healthy, body, recovered, assignee }, nowMs) {
  const openIssue = await client.findOpenIssue(title);
  if (healthy) {
    if (openIssue) {
      await client.comment(openIssue.number, recovered);
      await client.close(openIssue.number);
      console.log(`[feed-health] ${label}: closed #${openIssue.number}`);
    }
    return;
  }
  if (!openIssue) {
    const created = await client.createIssue(title, body, assignee);
    console.log(`[feed-health] ${label}: opened #${created.number}`);
    return;
  }
  const sinceIso = new Date(nowMs - REMINDER_INTERVAL_MS).toISOString();
  const openedRecently = Date.parse(openIssue.created_at) > nowMs - REMINDER_INTERVAL_MS;
  const pingedRecently =
    openedRecently ||
    (await client.listCommentBodiesSince(openIssue.number, sinceIso)).some((comment) => comment.includes(MARKER));
  if (!pingedRecently) {
    await client.comment(openIssue.number, body);
    console.log(`[feed-health] ${label}: updated #${openIssue.number}`);
  }
}

async function checkFeed(client, feed, assignee, nowMs) {
  const status = await client.getStatus(feed);
  const verdict = evaluateFeed(feed, status, nowMs);
  if (verdict.healthy) {
    console.log(`[feed-health] ${feed.name}: ok (last success ${status.latestSuccess.created_at})`);
  } else {
    console.log(`[feed-health] ${feed.name}: UNHEALTHY - ${verdict.reasons.join('; ')}`);
  }
  await syncIssue(
    client,
    {
      title: issueTitle(feed),
      label: feed.name,
      healthy: verdict.healthy,
      body: verdict.healthy ? '' : issueBody(feed, verdict, status, assignee),
      recovered: verdict.healthy ? `Recovered: successful run at ${status.latestSuccess.created_at}.` : '',
      assignee,
    },
    nowMs
  );
  return verdict;
}

function liveIssueTitle(check) {
  return `Service down: ${check.name}`;
}

function liveIssueBody(check, verdict, assignee) {
  return [
    `@${assignee} **${check.name}** is unhealthy:`,
    '',
    ...verdict.reasons.map((reason) => `- ${reason}`),
    '',
    'Road matching falls back to Mapbox Directions (paid per call) until it recovers. Runbook: infra/valhalla/README.md.',
    'This issue closes itself once the check passes again.',
    MARKER,
  ].join('\n');
}

async function checkLive(client, check, assignee, env, nowMs, fetchImpl) {
  const verdict = await check.probe(env, fetchImpl);
  if (!verdict.configured) {
    console.log(`[feed-health] ${check.name}: not configured (VALHALLA_URL / VALHALLA_SHARED_SECRET unset) - skipped`);
    return verdict;
  }
  console.log(`[feed-health] ${check.name}: ${verdict.healthy ? 'ok' : `UNHEALTHY - ${verdict.reasons.join('; ')}`}`);
  await syncIssue(
    client,
    {
      title: liveIssueTitle(check),
      label: check.name,
      healthy: verdict.healthy,
      body: verdict.healthy ? '' : liveIssueBody(check, verdict, assignee),
      recovered: `Recovered: ${check.name} check passed at ${new Date(nowMs).toISOString()}.`,
      assignee,
    },
    nowMs
  );
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
  for (const check of LIVE_CHECKS) {
    const verdict = await checkLive(client, check, assignee, process.env, Date.now());
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

module.exports = { FEEDS, LIVE_CHECKS, evaluateFeed, checkFeed, checkLive, probeValhalla, issueTitle, liveIssueTitle };
