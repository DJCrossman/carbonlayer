import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrStage, PrStages } from '../model';
import type { RpcMethod, RpcRequest } from '../rpc';
import { DEFAULT_SETTINGS } from '../settings';
import { handleRpc } from './index';
import { forgetPrStages } from './pr-stages';
import { SIGNED_OUT } from './session';

vi.mock('../settings', async (original) => ({ ...(await original<typeof import('../settings')>()), getSettings: vi.fn(async () => DEFAULT_SETTINGS) }));

let requests: string[];
beforeEach(() => {
  requests = serveGitHub();
});
afterEach(() => {
  forgetPrStages(STAGES);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the PR page in stages', () => {
  it.each([
    ['header', ['page', 'tab_counts', 'diffstat']],
    ['activity', ['page', 'threads']],
    ['files', ['base_comparison_info']],
    ['threads', ['threads', 'base_comparison_info', 'page', 'tab_counts']],
    ['mergeBox', ['page', 'merge_box', 'review_requests']],
    ['checks', ['page', 'tab_counts', 'diffstat', 'status_checks', 'actions']],
    ['stack', ['page', 'tab_counts', 'diffstat']],
    ['meta', ['labels', 'assignees']],
  ] as const)('%s asks GitHub for %j', async (stage, asked) => {
    await loadStage(stage);
    expect(requests.toSorted()).toEqual([...asked].sort());
  });

  it('fetches the page once for all the stages that read it, and each other route once', async () => {
    await Promise.all(STAGES.map((stage) => loadStage(stage)));
    expect(requests.toSorted()).toEqual(
      ['page', 'tab_counts', 'diffstat', 'threads', 'base_comparison_info', 'merge_box', 'review_requests', 'status_checks', 'actions', 'labels', 'assignees'].sort(),
    );
  });

  it('puts the header together from the page and its counts, with the description and its reactions as the conversation renders them', async () => {
    expect(await loadStage('header')).toMatchObject({
      id: 'PR_1',
      title: 'Fix the widget',
      state: 'OPEN',
      viewerLogin: 'ana',
      viewerDidAuthor: false,
      bodyHtml: '<p>The description</p>',
      descriptionReactions: [{ content: 'HOORAY', count: 3, viewerHasReacted: true }],
      additions: 3,
      deletions: 1,
      changedFiles: 2,
      updatedAt: '2026-10-02T00:00:00Z',
      stackSource: 'none',
    });
  });

  it('lists the files with the diffs GitHub sent along, and fetches the others by path', async () => {
    const files = await loadStage('files');
    expect(files.files.map((file) => file.path)).toEqual(['a.ts', 'b.ts']);
    expect(Object.keys(files.diffs)).toEqual(['a.ts']);
    expect(await call('pr.fetchFileDiffs', { repo, number: 1, paths: ['b.ts'] })).toEqual({ 'b.ts': { patch: '@@ -0,0 +1,1 @@\n+x', previousPath: null } });
    expect(requests).toEqual(['base_comparison_info', 'diff_entries']);
  });

  it('places the threads with the comparison and links the activity’s review to them', async () => {
    const [threads, activity] = await Promise.all([loadStage('threads'), loadStage('activity')]);
    expect(threads).toMatchObject({ threads: [{ id: '7', path: 'a.ts', line: 2 }], unresolvedThreadCount: 1 });
    expect(activity.timeline).toMatchObject([{ kind: 'review', threadIds: ['7'] }]);
  });

  it('after a write, reloading every stage asks GitHub again only for what the stages the write changed asked', async () => {
    await Promise.all(STAGES.map((stage) => loadStage(stage)));

    requests.length = 0;
    await call('pr.comment', { prId: 'PR_1', body: 'Thanks' });
    await Promise.all(STAGES.map((stage) => loadStage(stage)));
    expect(requests).toEqual(['POST create_timeline_comment', 'page']);

    requests.length = 0;
    await call('pr.resolveThread', { threadId: '7', resolved: true });
    await Promise.all(STAGES.map((stage) => loadStage(stage)));
    expect(requests.toSorted()).toEqual(['POST resolve_thread', 'base_comparison_info', 'tab_counts', 'threads'].sort());
  });

  it("reacts with the token of the page's reaction forms, and reloads nothing for it", async () => {
    await Promise.all(STAGES.map((stage) => loadStage(stage)));
    requests.length = 0;
    await call('pr.react', { prId: 'PR_1', subjectId: 'PR_1', content: 'HOORAY', add: false });
    await Promise.all(STAGES.map((stage) => loadStage(stage)));
    expect(requests).toEqual(['POST reactions']);
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/o\/r\/reactions$/), expect.objectContaining({ body: expect.stringContaining('authenticity_token=reaction-token') }));
  });

  it('repeats only the requests a forced stage makes for itself', async () => {
    await Promise.all(STAGES.map((stage) => loadStage(stage)));
    requests.length = 0;
    await loadStage('mergeBox', true);
    expect(requests.toSorted()).toEqual(['merge_box', 'review_requests']);
  });

  it('asks GitHub once for a request several stages forced together repeat', async () => {
    await Promise.all(STAGES.map((stage) => loadStage(stage)));
    requests.length = 0;
    await Promise.all(STAGES.map((stage) => loadStage(stage, true)));
    // The Actions list is kept per head commit for 5 minutes, forced or not.
    expect(requests.toSorted()).toEqual(['page', 'tab_counts', 'diffstat', 'threads', 'base_comparison_info', 'merge_box', 'review_requests', 'status_checks', 'labels', 'assignees'].sort());
  });

  it('leaves a side card empty when GitHub has no such route, and fails its stage on anything else', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    requests = serveGitHub({ status_checks: 404 });
    expect(await loadStage('checks')).toMatchObject({ ci: { state: 'NONE', checks: [] } });
    forgetPrStages(STAGES);
    requests = serveGitHub({ status_checks: 502 });
    await expect(loadStage('checks')).rejects.toThrow('GitHub answered 502');
  });

  it('says the checks card is empty because GitHub answered 404', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    requests = serveGitHub({ status_checks: 404 });
    expect(await loadStage('checks')).toMatchObject({ ci: { checks: [] }, emptyReason: 'GitHub answered 404 for page_data/status_checks' });
  });

  it('says the checks card is empty because GitHub sent no check rows, naming what it sent', async () => {
    requests = serveGitHub({}, 'ana', { status_checks: { statusRollup: { combinedState: 'PASSED', summary: [] }, statusChecks: [] } });
    expect(await loadStage('checks')).toMatchObject({ ci: { checks: [] }, emptyReason: 'GitHub sent no checks (keys: statusRollup, statusChecks)' });
  });

  it("adds a failed run of GitHub's own Copilot review, from the Actions list of the header's branch, to the checks", async () => {
    requests = serveGitHub({}, 'ana', {
      actions: `<ul><li aria-label="failed: Run 2557 of Copilot. Running Copilot Code Review"><a href="https://github.com/o/r/actions/runs/31">Running Copilot Code Review</a><relative-time datetime="2026-10-12T19:43:25.000Z"></relative-time></li></ul>`,
    });
    const { ci } = await loadStage('checks');
    expect(ci.state).toBe('FAILURE');
    expect(ci.checks.map((check) => [check.name, check.state])).toEqual([
      ['build', 'SUCCESS'],
      ['Copilot / Running Copilot Code Review', 'FAILURE'],
    ]);
    expect(fetch).toHaveBeenCalledWith('/o/r/actions?query=branch%3Afix+event%3Adynamic', expect.anything());
    expect(requests).toContain('actions/runs/31');
  });

  it('asks a signed-out viewer to sign in from the header', async () => {
    requests = serveGitHub({}, '');
    await expect(loadStage('header')).rejects.toThrow(SIGNED_OUT);
  });
});

const repo = { owner: 'o', name: 'r' };
const STAGES: PrStage[] = ['header', 'activity', 'files', 'threads', 'mergeBox', 'checks', 'stack', 'meta'];

async function call(method: RpcMethod, args: unknown) {
  const response = await handleRpc({ kind: 'gg-rpc', id: 'req', method, args } as RpcRequest);
  if (!response.ok) throw new Error(response.error);
  return response.result;
}

async function loadStage<S extends PrStage>(stage: S, force = false) {
  const method = `pr.fetch${stage[0]!.toUpperCase()}${stage.slice(1)}` as RpcMethod;
  return (await call(method, { repo, number: 1, force })) as PrStages[S];
}

/**
 * github.com for PR o/r#1, recording each request as its page_data route (`page` for the page itself, `POST <route>`
 * for a write, `actions` for the branch's Actions list, `actions/runs/<id>` for a run's page, `reactions` for a reaction). `failing` answers a route
 * with that status instead, `answers` with that answer. Each call has a head commit of its own: what the Actions list
 * says about a commit is kept 5 minutes.
 */
function serveGitHub(failing: Record<string, number> = {}, viewer = 'ana', answers: Record<string, unknown> = {}): string[] {
  const asked: string[] = [];
  const headSha = String(++heads).padStart(40, '0');
  const layout = {
    pullRequest: { id: 1, relayId: 'PR_1', number: 1, title: 'Fix the widget', state: 'OPEN', author: { login: 'bo' }, baseBranch: 'main', headBranch: 'fix', headSha, createdTime: '2026-10-01T00:00:00Z' },
    stack: null,
  };
  const page = `<html><head><meta name="user-login" content="${viewer}"></head><body>
    <script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: { pullRequestsLayoutRoute: layout } })}</script>
    <div class="TimelineItem"><div id="pullrequest-1" class="timeline-comment"><div class="comment-body"><p>The description</p></div>
      <form class="js-pick-reaction" action="/o/r/reactions" method="post"><input type="hidden" name="authenticity_token" value="reaction-token"><input type="hidden" name="input[subjectId]" value="PR_1">
        <button name="input[content]" value="HOORAY unreact" class="social-reaction-summary-item js-reaction-group-button"><g-emoji alias="tada">🎉</g-emoji> 3</button></form></div></div>
    <div id="pullrequestreview-9"><div class="TimelineItem"><div class="TimelineItem-body"><a class="author">cy</a> left a comment <relative-time datetime="2026-10-02T00:00:00Z"></relative-time></div></div></div>
  </body></html>`;
  const routes: Record<string, unknown> = {
    tab_counts: { filesChangedCount: 2, conversationCount: 3, unresolvedConversationCount: 1 },
    diffstat: { diffstat: { linesAdded: 3, linesDeleted: 1 } },
    threads: { threads: [{ id: '7', isResolved: false, pullRequestReviewId: 9, commentsData: { comments: [{ databaseId: 70, author: { login: 'cy' }, bodyHTML: '<p>nit</p>' }] } }] },
    base_comparison_info: {
      diffSummaries: [
        { path: 'a.ts', changeType: 'MODIFIED', linesAdded: 1, linesDeleted: 1, markersMap: { R2: { threads: [{ id: 7 }] } } },
        { path: 'b.ts', changeType: 'ADDED', linesAdded: 1 },
      ],
      diffContents: [{ path: 'a.ts', diffLines: [{ type: 'HUNK', text: '@@ -1,1 +1,1 @@' }, { type: 'DELETION', text: '-a' }, { type: 'ADDITION', text: '+b' }] }],
      comparison: { fullDiff: { baseOid: 'b', headOid: 'h' } },
    },
    diff_entries: [{ path: 'b.ts', diffLines: [{ type: 'HUNK', text: '@@ -0,0 +1,1 @@' }, { type: 'ADDITION', text: '+x' }] }],
    merge_box: { pullRequest: { mergeStateStatus: 'CLEAN' } },
    review_requests: { pendingReviewRequests: [], completedReviews: [] },
    status_checks: { statusChecks: [{ displayName: 'build', state: 'SUCCESS' }] },
    labels: { labels: [{ name: 'bug', color: 'd73a4a' }] },
    assignees: { assignees: [{ login: 'bo' }] },
    create_timeline_comment: {},
    resolve_thread: {},
    reactions: {},
    // No runs of GitHub's own dynamic workflows on the branch.
    actions: '<ul></ul>',
    ...answers,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const route = /\/o\/r\/(actions(?:\/runs\/\d+)?|reactions)/.exec(url)?.[1] ?? /\/o\/r\/pull\/1(?:\/page_data\/([a-z_]+))?/.exec(url)?.[1] ?? 'page';
      asked.push(init?.method ? `${init.method} ${route}` : route);
      const status = failing[route];
      if (status) return Response.json({ error: 'Not Found' }, { status });
      if (route === 'page') return new Response(page, { headers: { 'content-type': 'text/html' } });
      // The Actions pages are HTML; a run's page names the commit it ran on, the head.
      if (route.startsWith('actions')) {
        return new Response(route === 'actions' ? String(routes.actions) : `<title>Running Copilot Code Review · o/r@${headSha}</title>`, { headers: { 'content-type': 'text/html' } });
      }
      return route in routes ? Response.json(routes[route]) : Response.json({ error: 'Not Found' }, { status: 404 });
    }),
  );
  return asked;
}

/** The head commits serveGitHub has made up so far. */
let heads = 0;
