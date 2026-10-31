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

  it("sends a comment on a whole file in the form of GitHub's file comment, with no line, posted now or batched into a review", async () => {
    const file = { subjectType: 'file', path: 'docs/zones.png', body: 'Compress this' } as const;
    await mutations['pr.addThread']({ prId: 'PR_1', ...file });
    await mutations['pr.review']({ prId: 'PR_1', event: 'COMMENT', body: '', threads: [file] });
    const body = { text: 'Compress this', comparisonStartOid: 'base', comparisonEndOid: 'head', subjectType: 'file', path: 'docs/zones.png' };
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

  it('closes a PR, then deletes its branch where GitHub lets the viewer and no open PR is based on it', async () => {
    const branch = (viewerCanDeleteHeadRef: boolean, basedOn: number[]) => {
      reads = {
        [`${P}/merge_box`]: { pullRequest: { viewerCanDeleteHeadRef, headRefName: 'ana/feature' } },
        '/pulls/search': {
          payload: {
            pullsDashboardSurfaceContentRoute: {
              results: basedOn.map((number) => ({ id: `PR_${number}`, number, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' })),
              pageInfo: { totalCount: basedOn.length },
            },
          },
        },
      };
    };
    const writes = () => sent.splice(0).map(({ method, path }) => [method, path]);
    const closing = ['POST', `${P}/close_pull_request`];

    branch(true, []);
    await expect(mutations['pr.close']({ prId: 'PR_1' })).resolves.toEqual({ branch: { kind: 'deleted' } });
    expect(writes()).toEqual([closing, ['POST', `${P}/delete_head_ref`]]);

    branch(true, [2]);
    await expect(mutations['pr.close']({ prId: 'PR_1' })).resolves.toEqual({ branch: { kind: 'based-on', numbers: [2] } });
    expect(writes()).toEqual([closing]);

    branch(false, []);
    await expect(mutations['pr.close']({ prId: 'PR_1' })).resolves.toEqual({ branch: { kind: 'kept' } });
    expect(writes()).toEqual([closing]);

    // Closed, a branch GitHub could not be asked about stays, and the page hears why.
    reads = {};
    await expect(mutations['pr.close']({ prId: 'PR_1' })).resolves.toEqual({ branch: { kind: 'failed', reason: 'GitHub answered 404 for /o/r/pull/1/page_data/merge_box' } });
    expect(writes()).toEqual([closing]);
  });

  it('reopens a PR, first restoring its branch where GitHub says it was deleted', async () => {
    const writes = () => sent.splice(0).map(({ method, path }) => [method, path]);

    reads = { [`${P}/merge_box`]: { pullRequest: { viewerCanRestoreHeadRef: true } } };
    await mutations['pr.reopen']({ prId: 'PR_1' });
    expect(writes()).toEqual([
      ['POST', `${P}/restore_head_ref`],
      ['POST', `${P}/reopen_pull_request`],
    ]);

    reads = { [`${P}/merge_box`]: { pullRequest: { viewerCanRestoreHeadRef: false } } };
    await mutations['pr.reopen']({ prId: 'PR_1' });
    expect(writes()).toEqual([['POST', `${P}/reopen_pull_request`]]);

    // Not knowing whether its branch is there, it sends nothing.
    reads = {};
    await expect(mutations['pr.reopen']({ prId: 'PR_1' })).rejects.toThrow('GitHub answered 404 for /o/r/pull/1/page_data/merge_box');
    expect(writes()).toEqual([]);
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

  it("reacts to a diff comment as GitHub's files view does: the PR's comment reaction route, by the comment's database id", async () => {
    await mutations['pr.react']({ prId: 'PR_1', subjectId: 'PRRC_1_9002', content: 'HEART', add: true });
    await mutations['pr.react']({ prId: 'PR_1', subjectId: 'PRRC_1_9002', content: 'HEART', add: false });
    expect(sent).toEqual([
      { method: 'POST', path: `${P}/add_comment_reaction`, body: { reaction: 'HEART', commentId: 9002 } },
      { method: 'POST', path: `${P}/remove_comment_reaction`, body: { reaction: 'HEART', commentId: 9002 } },
    ]);
  });

  it("reacts through GitHub's reactable-item route by the subject's node id, POST adding and DELETE removing, and passes on GitHub's refusal", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ data: { addReaction: { subject: { id: 'IC_7' } } } }));
    vi.stubGlobal('fetch', fetch);
    await mutations['pr.react']({ prId: 'PR_1', subjectId: 'IC_7', content: 'THUMBS_UP', add: true });
    await mutations['pr.react']({ prId: 'PR_1', subjectId: 'PRR_3', content: 'HEART', add: false });
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, JSON.parse(String(init.body))])).toEqual([
      ['/reactable_item/reactions', 'POST', { subjectId: 'IC_7', content: 'THUMBS_UP' }],
      ['/reactable_item/reactions', 'DELETE', { subjectId: 'PRR_3', content: 'HEART' }],
    ]);
    expect(fetch.mock.calls[0]).toHaveProperty([1, 'headers', 'GitHub-Verified-Fetch'], 'true');
    fetch.mockResolvedValueOnce(Response.json({ data: null, errors: [{ message: 'Could not add reaction' }] }));
    await expect(mutations['pr.react']({ prId: 'PR_1', subjectId: 'IC_7', content: 'ROCKET', add: true })).rejects.toThrow('Could not add reaction');
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

  it("saves edits as GitHub's own page does: the description as JSON, a comment and a review's summary as form fields with their version, a diff comment by its database id", async () => {
    const writes: Array<{ method: string; url: string; contentType: string | null; accept: string | null; verified: string | null; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const headers = new Headers(init.headers);
        const body = init.body instanceof FormData ? [...init.body.entries()] : JSON.parse(String(init.body));
        writes.push({ method: init.method ?? 'GET', url, contentType: headers.get('Content-Type'), accept: headers.get('Accept'), verified: headers.get('GitHub-Verified-Fetch'), body });
        return Response.json({});
      }),
    );
    await mutations['pr.editDescription']({ prId: 'PR_1', body: 'The new description' });
    await mutations['pr.editComment']({ prId: 'PR_1', commentId: 'issuecomment-11', version: 'v-11', body: 'Edited' });
    await mutations['pr.editComment']({ prId: 'PR_1', commentId: 'pullrequestreview-21', body: 'Edited review' });
    await mutations['pr.editThreadComment']({ prId: 'PR_1', commentId: '9001', version: 'v-9001', body: 'Edited diff comment' });
    await mutations['pr.editThreadComment']({ prId: 'PR_1', commentId: '9002', body: 'No version' });
    const verified = { accept: 'application/json', verified: 'true' };
    expect(writes).toEqual([
      { method: 'PATCH', url: `${P}/update_description`, contentType: 'application/json', ...verified, body: { body: 'The new description' } },
      { method: 'PUT', url: '/o/r/issue_comments/11', contentType: null, ...verified, body: [['issue_comment[body]', 'Edited'], ['body_version', 'v-11']] },
      { method: 'PUT', url: '/o/r/pull/1/reviews/21/update', contentType: null, ...verified, body: [['pull_request_review[body]', 'Edited review']] },
      { method: 'PUT', url: `${P}/update_review_comment?body_version=v-9001`, contentType: 'application/json', ...verified, body: { body: 'Edited diff comment', commentId: '9001' } },
      { method: 'PUT', url: `${P}/update_review_comment`, contentType: 'application/json', ...verified, body: { body: 'No version', commentId: '9002' } },
    ]);
  });

  it("says in GitHub's words why it refused an edit: made over a newer one, or GitHub's own reason", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ stale: true, updated_markdown: 'Theirs', version: 'v-2' }, { status: 422 })));
    await expect(mutations['pr.editComment']({ prId: 'PR_1', commentId: 'issuecomment-11', version: 'v-1', body: 'Mine' })).rejects.toThrow(
      'The content you are editing has changed. Please review the latest changes and try again.',
    );
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Body is too long (maximum is 65536 characters)' }, { status: 422 })));
    await expect(mutations['pr.editThreadComment']({ prId: 'PR_1', commentId: '9001', version: 'v-9001', body: 'Long' })).rejects.toThrow('Body is too long (maximum is 65536 characters)');
    await expect(mutations['pr.editComment']({ prId: 'PR_1', commentId: 'commit-1', body: 'x' })).rejects.toThrow('There is no comment commit-1 to edit');
    await expect(mutations['pr.editDescription']({ prId: 'PR_unknown', body: 'x' })).rejects.toThrow('Open the pull request first');
  });

  it("deletes as GitHub's own page does: a conversation comment at its repository's address, a diff comment by its database id, with no body", async () => {
    const writes: Array<{ method: string; url: string; verified: string | null; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        writes.push({ method: init.method ?? 'GET', url, verified: new Headers(init.headers).get('GitHub-Verified-Fetch'), body: init.body ?? null });
        return new Response(null, { status: 204 });
      }),
    );
    await mutations['pr.deleteComment']({ prId: 'PR_1', commentId: 'issuecomment-11' });
    await mutations['pr.deleteThreadComment']({ prId: 'PR_1', commentId: '9001' });
    expect(writes).toEqual([
      { method: 'DELETE', url: '/o/r/issue_comments/11', verified: 'true', body: null },
      { method: 'DELETE', url: `${P}/review_comments/9001`, verified: 'true', body: null },
    ]);
  });

  it("says in GitHub's words why it refused a delete, and deletes no review", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Comment could not be deleted' }, { status: 422 })));
    await expect(mutations['pr.deleteThreadComment']({ prId: 'PR_1', commentId: '9001' })).rejects.toThrow('Comment could not be deleted');
    await expect(mutations['pr.deleteComment']({ prId: 'PR_1', commentId: 'pullrequestreview-21' })).rejects.toThrow('There is no comment pullrequestreview-21 to delete');
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
        comments: ['9001', '9002'].map((commentId) => ({ id: commentId, author: { login: 'ana', avatarUrl: '', url: '' }, bodyHtml: '', createdAt: '', url: '', subjectId: `PRRC_${number}_${commentId}`, reactions: [] })),
      },
    ],
  };
}
