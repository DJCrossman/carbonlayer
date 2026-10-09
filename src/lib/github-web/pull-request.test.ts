import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPullRequestPage } from './pull-request';
import { SIGNED_OUT } from './session';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fetchPullRequestPage', () => {
  it('renders a signed-in PR without the side details GitHub refuses, logging each', async () => {
    serveGitHub({ viewer: 'ana' });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const pr = await fetchPullRequestPage({ owner: 'o', name: 'r' }, 1, 'MERGE');

    expect(pr).toMatchObject({
      title: 'Fix the widget',
      viewerLogin: 'ana',
      ci: { state: 'NONE', checks: [] },
      requiredCheckNames: [],
      reviewers: [],
      labels: [],
      assignees: [],
      mergeStatus: 'UNKNOWN',
      viewerCanMerge: false,
      bodyHtml: '<p>From the conversation</p>',
      additions: 3,
      deletions: 1,
    });
    for (const route of ['merge_box', 'status_checks', 'description', 'review_requests', 'labels', 'assignees']) {
      expect(debug).toHaveBeenCalledWith('[gg]', expect.stringContaining(`page_data/${route} failed`), `GitHub answered 404 for /o/r/pull/1/page_data/${route}`);
    }
  });

  it('asks a signed-out viewer to sign in, whatever else GitHub answered', async () => {
    serveGitHub({ viewer: '' });
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    await expect(fetchPullRequestPage({ owner: 'o', name: 'r' }, 1, 'MERGE')).rejects.toThrow(SIGNED_OUT);
  });
});

/** github.com for PR o/r#1 as a public repository serves it: the page and the routes that work signed out; 404 for the rest. */
function serveGitHub({ viewer }: { viewer: string }) {
  const layout = {
    pullRequest: { id: 1, relayId: 'PR_1', number: 1, title: 'Fix the widget', state: 'OPEN', author: { login: 'bo' }, baseBranch: 'main', headBranch: 'fix', headSha: 'h', createdTime: '2026-10-01T00:00:00Z' },
    stack: null,
  };
  const page = `<html><head><meta name="user-login" content="${viewer}"></head><body>
    <script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: { pullRequestsLayoutRoute: layout } })}</script>
    <div class="TimelineItem"><div id="pullrequest-1" class="timeline-comment"><div class="comment-body"><p>From the conversation</p></div></div></div>
  </body></html>`;
  const routes: Record<string, unknown> = {
    base_comparison_info: { diffSummaries: [], comparison: { fullDiff: { baseOid: 'b', headOid: 'h' } } },
    tab_counts: {},
    diffstat: { diffstat: { linesAdded: 3, linesDeleted: 1 } },
    threads: { threads: [] },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/o/r/pull/1') return new Response(page, { headers: { 'content-type': 'text/html' } });
      const route = /\/page_data\/([a-z_]+)/.exec(url)?.[1] ?? '';
      return route in routes ? Response.json(routes[route]) : Response.json({ error: 'Not Found' }, { status: 404 });
    }),
  );
}
