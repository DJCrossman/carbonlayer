import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import { mutations, rememberPullRequest } from './mutations';

vi.mock(import('../settings'), async (original) => ({ ...(await original()), getSettings: vi.fn(async () => DEFAULT_SETTINGS) }));

// Every request the mutations send, as `METHOD path body`; GETs are answered from `reads`.
let sent: Array<{ method: string; path: string; body: unknown }> = [];
let reads: Record<string, unknown> = {};

beforeEach(() => {
  sent = [];
  reads = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (method === 'GET') {
        const key = Object.keys(reads).find((prefix) => url.startsWith(prefix));
        return key ? Response.json(reads[key]) : Response.json({ error: 'Not Found' }, { status: 404 });
      }
      sent.push({ method, path: url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json({ status: 'merged', uuid: 'u-1' });
    }),
  );
  rememberPullRequest(pullRequest({ id: 'PR_1', stackSource: 'none' }));
  rememberPullRequest(pullRequest({ id: 'PR_2', number: 2, stackSource: 'native' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const P = '/o/r/pull/1/page_data';

describe('mutations', () => {
  it('submits a review after adding its batched inline comments to the pending review', async () => {
    await mutations['pr.review']({ prId: 'PR_1', event: 'REQUEST_CHANGES', body: 'Needs work', threads: [{ path: 'a.ts', line: 3, side: 'LEFT', body: 'Why?' }] });
    expect(sent).toEqual([
      {
        method: 'POST',
        path: `${P}/create_review_comment`,
        body: {
          text: 'Why?',
          submitBatch: false,
          comparisonStartOid: 'base',
          comparisonEndOid: 'head',
          subjectType: 'line',
          path: 'a.ts',
          line: 3,
          side: 'left',
          positioning: { type: 'line', baseCommitOid: 'base', headCommitOid: 'head', path: 'a.ts', line: 3, commitOid: 'base' },
        },
      },
      { method: 'PUT', path: `${P}/submit_review`, body: { body: 'Needs work', event: 'request changes', headSha: 'head' } },
    ]);
  });

  it('posts single comments, replies and thread resolution', async () => {
    await mutations['pr.comment']({ prId: 'PR_1', body: 'Thanks' });
    await mutations['pr.addThread']({ prId: 'PR_1', path: 'a.ts', line: 9, side: 'RIGHT', body: 'Nice' });
    await mutations['pr.replyThread']({ threadId: '100', body: 'Done' });
    await mutations['pr.resolveThread']({ threadId: '100', resolved: true });
    await mutations['pr.resolveThread']({ threadId: '100', resolved: false });
    expect(sent[0]).toEqual({ method: 'POST', path: `${P}/create_timeline_comment`, body: { text: 'Thanks' } });
    expect(sent[1]?.body).toMatchObject({ submitBatch: true, side: 'right', positioning: { commitOid: 'head' } });
    expect(sent[2]).toEqual({
      method: 'POST',
      path: `${P}/create_review_comment`,
      body: { text: 'Done', submitBatch: true, inReplyTo: 9002, path: 'src/a.ts', comparisonStartOid: 'base', comparisonEndOid: 'head' },
    });
    expect(sent.slice(3)).toEqual([
      { method: 'POST', path: `${P}/resolve_thread`, body: { threadId: '100' } },
      { method: 'POST', path: `${P}/unresolve_thread`, body: { threadId: '100' } },
    ]);
  });

  it("sends a comment on several lines in the form of GitHub's multi-line comment, posted now or batched into a review", async () => {
    const range = { path: 'a.ts', line: 18, side: 'RIGHT', startLine: 12, startSide: 'LEFT', body: 'Extract this' } as const;
    await mutations['pr.addThread']({ prId: 'PR_1', ...range });
    await mutations['pr.review']({ prId: 'PR_1', event: 'COMMENT', body: '', threads: [range] });
    const body = {
      text: 'Extract this',
      comparisonStartOid: 'base',
      comparisonEndOid: 'head',
      subjectType: 'multiline',
      path: 'a.ts',
      line: 18,
      side: 'right',
      startLine: 12,
      startSide: 'left',
      positioning: {
        type: 'multiline',
        baseCommitOid: 'base',
        headCommitOid: 'head',
        startPath: 'a.ts',
        startLine: 12,
        startCommitOid: 'base',
        endPath: 'a.ts',
        endLine: 18,
        endCommitOid: 'head',
      },
    };
    expect(sent.slice(0, 2)).toEqual([
      { method: 'POST', path: `${P}/create_review_comment`, body: { ...body, submitBatch: true } },
      { method: 'POST', path: `${P}/create_review_comment`, body: { ...body, submitBatch: false } },
    ]);
  });

  it('merges with the commit message GitHub proposes, but not after new pushes', async () => {
    reads = {
      [`${P}/header`]: { pullRequest: { headSha: 'head' } },
      [`${P}/merge_box`]: { mergeRequirements: { commitMessageHeadline: 'Add widgets (#1)', commitMessageBody: '* one' } },
    };
    await mutations['pr.merge']({ prId: 'PR_1', method: 'SQUASH', expectedHeadOid: 'head' });
    expect(sent).toEqual([
      { method: 'POST', path: `${P}/merge`, body: { mergeMethod: 'SQUASH', commitTitle: 'Add widgets (#1)', commitMessage: '* one', bypassBranchProtections: false } },
    ]);

    reads[`${P}/header`] = { pullRequest: { headSha: 'newer' } };
    await expect(mutations['pr.merge']({ prId: 'PR_1', method: 'SQUASH', expectedHeadOid: 'head' })).rejects.toThrow('New commits were pushed');
  });

  it('merges a GitHub-native stack through the stack queue', async () => {
    reads = { '/o/r/pull/2/page_data/header': { pullRequest: { headSha: 'head' } }, '/o/r/pull/2/page_data/merge_box': { mergeRequirements: {} } };
    await mutations['pr.merge']({ prId: 'PR_2', method: 'MERGE', expectedHeadOid: 'head' });
    expect(sent).toEqual([
      { method: 'POST', path: '/o/r/pull/2/page_data/enqueue_stack', body: { mergeAction: 'DIRECT_MERGE', mergeMethod: 'MERGE', commitTitle: '', commitMessage: '', bypassRules: 'false' } },
    ]);
  });

  it('merges with the merge commit the viewer wrote, without asking GitHub to propose one', async () => {
    reads = { '/o/r/pull/2/page_data/header': { pullRequest: { headSha: 'head' } } };
    await mutations['pr.merge']({ prId: 'PR_2', method: 'MERGE', expectedHeadOid: 'head', commit: { commitTitle: 'Merge the PARCS stack', commitMessage: 'Zones too' } });
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/o/r/pull/2/page_data/enqueue_stack',
        body: { mergeAction: 'DIRECT_MERGE', mergeMethod: 'MERGE', commitTitle: 'Merge the PARCS stack', commitMessage: 'Zones too', bypassRules: 'false' },
      },
    ]);
  });

  it('toggles viewed files, draft state and auto-merge', async () => {
    reads = { [`${P}/merge_box`]: { mergeRequirements: { commitMessageHeadline: 'T', commitMessageBody: 'B' } } };
    await mutations['pr.markFileViewed']({ prId: 'PR_1', path: 'a.ts', viewed: true });
    await mutations['pr.markFileViewed']({ prId: 'PR_1', path: 'a.ts', viewed: false });
    await mutations['pr.setDraft']({ prId: 'PR_1', draft: true });
    await mutations['pr.setDraft']({ prId: 'PR_1', draft: false });
    await mutations['pr.setAutoMerge']({ prId: 'PR_1', enabled: true, method: 'REBASE' });
    await mutations['pr.setAutoMerge']({ prId: 'PR_1', enabled: false, method: 'REBASE' });
    expect(sent.map(({ method, path, body }) => [method, path, body])).toEqual([
      ['POST', '/o/r/pull/1/file_review', { path: 'a.ts', viewed: 'viewed' }],
      ['DELETE', '/o/r/pull/1/file_review', { path: 'a.ts', _method: 'delete' }],
      ['POST', `${P}/convert_to_draft`, undefined],
      ['POST', `${P}/mark_ready_for_review`, undefined],
      ['POST', `${P}/enable_auto_merge`, { mergeMethod: 'REBASE', commitTitle: 'T', commitMessage: 'B' }],
      ['POST', `${P}/disable_auto_merge`, undefined],
    ]);
  });

  it('turns auto-merge on for a GitHub-native stack through the stack queue, and off as for a PR alone', async () => {
    reads = { '/o/r/pull/2/page_data/merge_box': { mergeRequirements: { commitMessageHeadline: 'Add zones (#2)', commitMessageBody: '* zones' } } };
    await mutations['pr.setAutoMerge']({ prId: 'PR_2', enabled: true, method: 'SQUASH' });
    await mutations['pr.setAutoMerge']({ prId: 'PR_2', enabled: false, method: 'SQUASH' });
    expect(sent).toEqual([
      { method: 'POST', path: '/o/r/pull/2/page_data/enqueue_stack', body: { mergeAction: 'AUTO_MERGE', mergeMethod: 'SQUASH', commitTitle: 'Add zones (#2)', commitMessage: '* zones' } },
      { method: 'POST', path: '/o/r/pull/2/page_data/disable_auto_merge', body: undefined },
    ]);
  });

  it("rebases a native stack the way GitHub's Rebase stack does: the head of every branch not merged yet, by number, then its status until done", async () => {
    // The merge box's STACK condition as GitHub's bundle reads it, its entries' PRs under `pull`: #9 merged, #2 viewed, #3 a draft above.
    const entry = (position: string, status: string, number: number, state: string) => ({ position, status, pull: { number, headOid: `oid-${number}`, state } });
    reads = {
      '/o/r/pull/2/page_data/merge_box': {
        mergeRequirements: {
          conditions: [
            { type: 'PULL_REQUEST_USER_STATE', result: 'PASSED' },
            { type: 'STACK', result: 'PASSED', isStacked: true, entries: [entry('AFTER', 'IRRELEVANT_DRAFT', 3, 'DRAFT'), entry('CURRENT', 'NEEDS_MERGE_STATE', 2, 'OPEN'), entry('BEFORE', 'IRRELEVANT_MERGED', 9, 'MERGED')] },
          ],
        },
      },
      '/o/r/pull/2/page_data/stack_rebase_status': { jobState: 'DONE', pullRequestStates: [{ number: 2, state: 'SUCCEEDED', message: null }, { number: 3, state: 'SUCCEEDED', message: null }] },
    };
    await expect(mutations['pr.rebaseStack']({ prId: 'PR_2' })).resolves.toEqual({ complete: true });
    expect(sent).toEqual([{ method: 'POST', path: '/o/r/pull/2/page_data/stack_rebase', body: { expectedHeadOids: { '3': 'oid-3', '2': 'oid-2' } } }]);
  });

  it('asks how a stack rebase is going until GitHub says it is done, a second later and backing off', async () => {
    vi.useFakeTimers();
    reads = { '/o/r/pull/2/page_data/merge_box': { mergeRequirements: { conditions: [{ type: 'STACK', result: 'PASSED', isStacked: true, entries: [{ position: 'CURRENT', status: 'NEEDS_MERGE_STATE', pull: { number: 2, headOid: 'oid-2', state: 'OPEN' } }] }] } } };
    let asked = 0;
    Object.defineProperty(reads, '/o/r/pull/2/page_data/stack_rebase_status', {
      enumerable: true,
      get: () => (++asked < 3 ? { jobState: 'RUNNING', pullRequestStates: [{ number: 2, state: 'PENDING' }] } : { jobState: 'DONE', pullRequestStates: [{ number: 2, state: 'SUCCEEDED' }] }),
    });
    const rebasing = mutations['pr.rebaseStack']({ prId: 'PR_2' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(asked).toBe(2);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(rebasing).resolves.toEqual({ complete: true });
    expect(asked).toBe(3);
  });

  it("says in GitHub's words where a stack rebase stopped", async () => {
    reads = {
      '/o/r/pull/2/page_data/merge_box': { mergeRequirements: { conditions: [{ type: 'STACK', result: 'PASSED', isStacked: true, entries: [{ position: 'CURRENT', status: 'NEEDS_REBASE', pull: { number: 2, headOid: 'oid-2', state: 'OPEN' } }] }] } },
      '/o/r/pull/2/page_data/stack_rebase_status': { jobState: 'DONE', pullRequestStates: [{ number: 1, state: 'FAILED' }, { number: 2, state: 'CONFLICTED' }] },
    };
    await expect(mutations['pr.rebaseStack']({ prId: 'PR_2' })).rejects.toThrow(
      'Rebasing was stopped due to merge conflicts. Resolve the merge conflicts in pull request #2, then try to rebase this stack again.',
    );
    reads['/o/r/pull/2/page_data/stack_rebase_status'] = { jobState: 'DONE', pullRequestStates: [{ number: 1, state: 'FAILED' }] };
    await expect(mutations['pr.rebaseStack']({ prId: 'PR_2' })).rejects.toThrow('Rebasing was stopped due to an error. Check pull request #1 for any issues, then try to rebase this stack again.');
  });

  it('follows a stack rebase GitHub is still at without sending anything, until it is done or as long again as the first wait', async () => {
    vi.useFakeTimers();
    reads = { '/o/r/pull/2/page_data/stack_rebase_status': { jobState: 'RUNNING', pullRequestStates: [{ number: 2, state: 'PENDING' }] } };
    const following = mutations['pr.followStackRebase']({ prId: 'PR_2' });
    await vi.advanceTimersByTimeAsync(46_000);
    await expect(following).resolves.toEqual({ complete: false });
    reads = { '/o/r/pull/2/page_data/stack_rebase_status': { jobState: 'DONE', pullRequestStates: [{ number: 2, state: 'CONFLICTED' }] } };
    await expect(mutations['pr.followStackRebase']({ prId: 'PR_2' })).rejects.toThrow('Rebasing was stopped due to merge conflicts. Resolve the merge conflicts in pull request #2');
    expect(sent).toEqual([]);
  });

  it("reverts the way GitHub's Revert button does, and says where GitHub went next", async () => {
    const landed = 'https://github.com/o/r/compare/main...revert-1-feature?expand=1';
    const fetch = vi.fn(async () => Object.defineProperty(new Response('<html></html>'), 'url', { value: landed }));
    vi.stubGlobal('fetch', fetch);
    await expect(mutations['pr.revert']({ prId: 'PR_1' })).resolves.toEqual({ url: landed });
    expect(fetch).toHaveBeenCalledWith('/o/r/pull/1/revert', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    expect(fetch.mock.calls[0]).not.toHaveProperty([1, 'body']);
    expect(fetch.mock.calls[0]).toHaveProperty([1, 'headers', 'GitHub-Verified-Fetch'], 'true');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 422 })));
    await expect(mutations['pr.revert']({ prId: 'PR_1' })).rejects.toThrow('GitHub answered 422 to the revert');
  });

  it("reacts with GitHub's reaction form: its fields in order, the PR page's token, the button's value adding or removing", async () => {
    rememberPullRequest({ repo: { owner: 'o', name: 'r' }, number: 1, reactionToken: 'token-from-the-page' });
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({}));
    vi.stubGlobal('fetch', fetch);
    await mutations['pr.react']({ prId: 'PR_1', subjectId: 'IC_7', content: 'THUMBS_UP', add: true });
    await mutations['pr.react']({ prId: 'PR_1', subjectId: 'PRRC_9', content: 'HEART', add: false });
    expect(fetch.mock.calls.map(([url, init]) => [new URL(url).pathname, init.method, [...new URLSearchParams(String(init.body))]])).toEqual([
      [
        '/o/r/reactions',
        'POST',
        [
          ['_method', 'put'],
          ['authenticity_token', 'token-from-the-page'],
          ['input[subjectId]', 'IC_7'],
          ['input[content]', 'THUMBS_UP react'],
        ],
      ],
      [
        '/o/r/reactions',
        'POST',
        [
          ['_method', 'put'],
          ['authenticity_token', 'token-from-the-page'],
          ['input[subjectId]', 'PRRC_9'],
          ['input[content]', 'HEART unreact'],
        ],
      ],
    ]);
  });

  it("sets the labels with the labels menu's own form: its token, an empty field first, then every label the PR keeps or gains", async () => {
    const menu = `<form method="post" action="/o/r/labels"><input type="hidden" name="authenticity_token" value="new-label-token"></form>
      <form method="post" action="/o/r/issues/1/labels"><input type="hidden" name="_method" value="put"><input type="hidden" name="authenticity_token" value="labels-token">
        <div class="js-filterable-issue-labels">
          <label class="js-filterable-label" aria-checked="true"><input type="checkbox" name="issue[labels][]" value="11" data-label-name="area/api" checked></label>
          <label class="js-filterable-label" aria-checked="false"><input type="checkbox" name="issue[labels][]" value="12" data-label-name="bug"></label>
          <label class="js-filterable-label" aria-checked="true"><input type="checkbox" name="issue[labels][]" value="13" data-label-name="needs-qa" checked></label>
        </div></form>`;
    const fetch = vi.fn(async (_url: string, init: RequestInit = {}) => (init.method === 'POST' ? new Response('<div></div>') : new Response(menu)));
    vi.stubGlobal('fetch', fetch);
    await mutations['pr.modifyLabels']({ prId: 'PR_1', add: ['12'], remove: ['13'] });
    await mutations['pr.modifyLabels']({ prId: 'PR_1', add: [], remove: ['11', '13'] });
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts.map(([url, init]) => [new URL(url).pathname, [...new URLSearchParams(String(init?.body))]])).toEqual([
      [
        '/o/r/issues/1/labels',
        [
          ['_method', 'put'],
          ['authenticity_token', 'labels-token'],
          ['issue[labels][]', ''],
          ['issue[labels][]', '11'],
          ['issue[labels][]', '12'],
        ],
      ],
      [
        '/o/r/issues/1/labels',
        [
          ['_method', 'put'],
          ['authenticity_token', 'labels-token'],
          ['issue[labels][]', ''],
        ],
      ],
    ]);
    expect(fetch.mock.calls[0]?.[0]).toBe('/o/r/issues/1/show_partial?partial=issues%2Fsidebar%2Flabels_menu_content');
  });

  it('asks for a reload to react while the PR page has given no token', async () => {
    await expect(mutations['pr.react']({ prId: 'PR_2', subjectId: 'PR_2', content: 'ROCKET', add: true })).rejects.toThrow('Reload the pull request to react');
  });

  it('refuses to write to a pull request the app has not loaded', async () => {
    await expect(mutations['pr.comment']({ prId: 'PR_unknown', body: 'x' })).rejects.toThrow('Open the pull request first');
    await expect(mutations['pr.resolveThread']({ threadId: 'nope', resolved: true })).rejects.toThrow('Open the pull request first');
  });
});

function pullRequest({ id, number = 1, stackSource }: { id: string; number?: number; stackSource: 'native' | 'none' }): Parameters<typeof rememberPullRequest>[0] {
  return {
    id,
    repo: { owner: 'o', name: 'r' },
    number,
    headOid: 'head',
    baseOid: 'base',
    nativeStack: stackSource === 'native' ? { position: 2, size: 2 } : null,
    threads: [
      {
        id: `${number}00`,
        path: 'src/a.ts',
        line: 1,
        startLine: null,
        side: 'RIGHT',
        isResolved: false,
        isOutdated: false,
        diffHunk: '',
        comments: ['9001', '9002'].map((commentId) => ({ id: commentId, author: { login: 'ana', avatarUrl: '', url: '' }, bodyHtml: '', createdAt: '', url: '', subjectId: null, reactions: [] })),
      },
    ],
  };
}
