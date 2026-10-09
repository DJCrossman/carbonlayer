import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrichPull, fetchInbox, fetchViewPage, summarisePull, type Pull } from './inbox';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('summarisePull', () => {
  it('maps a dashboard row and its deferred fields', () => {
    const summary = summarisePull(
      pull(1, { reviewDecisionState: 'changes_requested', statusCheckRollup: { state: 'FAILURE', totalCount: 10, successCount: 7 }, stackPosition: 2, stackSize: 3 }),
      null,
    );
    expect(summary).toMatchObject({
      id: 'PR_1',
      repo: { owner: 'acme', name: 'widgets' },
      url: 'https://github.com/acme/widgets/pull/1',
      author: { login: 'ana', avatarUrl: 'https://github.com/ana.png?size=40', url: 'https://github.com/ana' },
      state: 'OPEN',
      reviewDecision: 'CHANGES_REQUESTED',
      ci: { state: 'FAILURE', checks: [], counts: { success: 7, failure: 3, pending: 0, other: 0 } },
      mergeStatus: 'UNKNOWN',
      unread: true,
      nativeStack: { position: 2, size: 3 },
    });
  });

  it("lets GitHub's own sections vouch for mergeability and the merge queue", () => {
    expect(summarisePull(pull(1), 'ready-to-merge').mergeStatus).toBe('CLEAN');
    expect(summarisePull(pull(1, { category: 'READY_TO_MERGE' }), null).mergeStatus).toBe('CLEAN');
    expect(summarisePull(pull(1, { isDraft: true }), 'ready-to-merge').mergeStatus).toBe('DRAFT');
    expect(summarisePull(pull(1), 'merge-queue').isInMergeQueue).toBe(true);
    expect(summarisePull(pull(1, { mergedAt: '2026-10-01T00:00:00Z' }), null).state).toBe('MERGED');
  });
});

describe('fetchInbox', () => {
  it('reads sections and searches, keeps each view to its limit, and merges the deferred fields by id', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        if (url.startsWith('/pulls/inbox/queries')) return Response.json({ results: [pull(1), pull(2), pull(3)], totalCount: 3 });
        if (url.startsWith('/pulls/inbox/deferred')) return Response.json([{ id: 'PR_1', reviewDecisionState: 'APPROVED' }]);
        if (url.startsWith('/pulls/search')) return Response.json({ payload: { pullsDashboardSurfaceContentRoute: { results: [pull(9)], pageInfo: { totalCount: 40 } } } });
        if (url.startsWith('/pulls/deferred')) return Response.json({ results: [{ id: 'PR_9', statusCheckRollup: { state: 'SUCCESS', totalCount: 2, successCount: 2 } }] });
        return new Response('', { status: 500 });
      }),
    );
    const [section, search] = await fetchInbox(
      [
        { id: 'a', name: 'Needs your review', query: 'inbox:review-requested', limit: 2 },
        { id: 'b', name: 'Mine', query: 'is:pr author:@me' },
      ],
      'org:acme',
    );

    expect(section?.prs.map((pr) => [pr.number, pr.reviewDecision])).toEqual([
      [1, 'APPROVED'],
      [2, 'NONE'],
    ]);
    expect(section?.totalCount).toBe(3);
    expect(search).toMatchObject({ totalCount: 40, prs: [{ number: 9, ci: { state: 'SUCCESS' } }] });
    expect(requested).toContain('/pulls/inbox/queries?filter=review-requested&max_pr_age=1m');
    expect(requested).toContain('/pulls/inbox/deferred?page=1&ids%5B%5D=PR_1&ids%5B%5D=PR_2');
    expect(requested).toContain(`/pulls/search?${new URLSearchParams({ q: 'org:acme is:pr author:@me' })}`);
  });

  it("fetches a later page of a search, or of one of GitHub's sections, whole", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        if (url.startsWith('/pulls/inbox/queries')) return Response.json({ results: [pull(30), pull(31)], totalCount: 60 });
        if (url.startsWith('/pulls/search')) return Response.json({ payload: { pullsDashboardSurfaceContentRoute: { results: [pull(26), pull(27), pull(28)], pageInfo: { totalCount: 40 } } } });
        return Response.json([]);
      }),
    );
    const search = await fetchViewPage({ id: 'b', name: 'Mine', query: 'is:pr author:@me', limit: 2 }, 'org:acme', 2);
    expect(search).toMatchObject({ totalCount: 40, prs: [{ number: 26 }, { number: 27 }, { number: 28 }] });
    const section = await fetchViewPage({ id: 'a', name: 'Needs your review', query: 'inbox:review-requested' }, '', 3);
    expect(section).toMatchObject({ totalCount: 60, prs: [{ number: 30 }, { number: 31 }] });
    const q = 'org:acme is:pr author:@me';
    expect(requested).toEqual([
      `/pulls/search?${new URLSearchParams({ q, page: '2' })}`,
      `/pulls/deferred?${new URLSearchParams([['q', q], ['page', '2'], ['ids[]', 'PR_26'], ['ids[]', 'PR_27'], ['ids[]', 'PR_28']])}`,
      '/pulls/inbox/queries?filter=review-requested&max_pr_age=1m&page=3',
      '/pulls/inbox/deferred?page=3&ids%5B%5D=PR_30&ids%5B%5D=PR_31',
    ]);
  });

  it('accepts a bare list of rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.startsWith('/pulls/inbox/queries') ? Response.json([pull(4)]) : Response.json([]))),
    );
    const [result] = await fetchInbox([{ id: 'a', name: 'Drafts', query: 'inbox:your-drafts' }], '');
    expect(result).toMatchObject({ totalCount: 1, prs: [{ number: 4 }] });
  });

  it('shows the rows without review and CI status when GitHub refuses their deferred fields', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.startsWith('/pulls/inbox/queries') ? Response.json([pull(5)]) : Response.json({ error: 'Not Found' }, { status: 404 }))),
    );
    const [result] = await fetchInbox([{ id: 'a', name: 'Drafts', query: 'inbox:your-drafts' }], '');
    expect(result?.prs).toMatchObject([{ number: 5, reviewDecision: 'NONE', ci: { state: 'NONE' } }]);
    expect(console.debug).toHaveBeenCalledWith('[gg]', expect.stringContaining('deferred fields failed'), 'GitHub answered 404 for /pulls/inbox/deferred');
  });
});

describe('enrichPull', () => {
  const widgets = { owner: 'acme', name: 'widgets' };

  it("reads mergeability and reviewers from the merge box, line counts from the diffstat", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        if (url.includes('/page_data/merge_box')) {
          return Response.json({
            pullRequest: { mergeStateStatus: 'DIRTY', latestOpinionatedReviews: [{ author: { login: 'bo', avatarUrl: 'https://avatars/bo' }, state: 'APPROVED' }] },
            reviewerSection: { pendingRequestedReviews: [{ reviewer: { login: 'cy', avatarUrl: 'https://avatars/cy' }, isCodeOwner: false }] },
          });
        }
        return Response.json({ diffstat: { linesAdded: 12, linesDeleted: 3, linesChanged: 15 } });
      }),
    );
    expect(await enrichPull({ repo: widgets, number: 7, state: 'OPEN', isDraft: false }, 'SQUASH')).toEqual({
      mergeStatus: 'DIRTY',
      reviewers: [
        { kind: 'user', user: { login: 'cy', avatarUrl: 'https://avatars/cy', url: 'https://github.com/cy' }, state: 'PENDING', id: undefined, canReRequest: false },
        { kind: 'user', user: { login: 'bo', avatarUrl: 'https://avatars/bo', url: 'https://github.com/bo' }, state: 'APPROVED' },
      ],
      additions: 12,
      deletions: 3,
    });
    expect(requested.sort()).toEqual(['/acme/widgets/pull/7/page_data/diffstat', '/acme/widgets/pull/7/page_data/merge_box?merge_method=SQUASH&bypass_requirements=false']);
  });

  it.each([
    ['a draft', { state: 'OPEN', isDraft: true }, { mergeStatus: 'DRAFT', additions: 4, deletions: 1 }],
    ['a merged pull request', { state: 'MERGED', isDraft: false }, { additions: 4, deletions: 1 }],
    ['a closed pull request', { state: 'CLOSED', isDraft: false }, { additions: 4, deletions: 1 }],
  ] as const)('asks no merge box for %s', async (_, pr, found) => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        return Response.json({ diffstat: { linesAdded: 4, linesDeleted: 1 } });
      }),
    );
    expect(await enrichPull({ repo: widgets, number: 8, ...pr }, 'MERGE')).toEqual(found);
    expect(requested).toEqual(['/acme/widgets/pull/8/page_data/diffstat']);
  });

  it('leaves out what GitHub refuses, and reviewers a merge box does not name', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/merge_box') ? Response.json({ mergeRequirements: { state: 'MERGEABLE', conditions: [] } }) : new Response('', { status: 500 }),
      ),
    );
    expect(await enrichPull({ repo: widgets, number: 9, state: 'OPEN', isDraft: false }, 'MERGE')).toEqual({ mergeStatus: 'CLEAN' });
    expect(console.debug).toHaveBeenCalledWith('[gg]', expect.stringContaining('page_data/diffstat for acme/widgets#9 failed'), 'GitHub answered 500 for /acme/widgets/pull/9/page_data/diffstat');

    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/merge_box') ? new Response('', { status: 404 }) : Response.json({ diffstat: { linesAdded: 1, linesDeleted: 0 } }))));
    expect(await enrichPull({ repo: widgets, number: 9, state: 'OPEN', isDraft: false }, 'MERGE')).toEqual({ additions: 1, deletions: 0 });
  });
});

function pull(number: number, overrides: Partial<Pull> = {}): Pull {
  return {
    id: `PR_${number}`,
    itemType: 'pull_request',
    number,
    title: `PR ${number}`,
    permalink: `https://github.com/acme/widgets/pull/${number}`,
    repoNameWithOwner: 'acme/widgets',
    author: { displayLogin: 'ana' },
    state: 'OPEN',
    isDraft: false,
    category: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    mergedAt: null,
    closedAt: null,
    isReadByCurrentUser: false,
    commentCount: 2,
    labels: [{ name: 'bug', color: 'd73a4a' }],
    stackPosition: null,
    stackSize: null,
    ...overrides,
  };
}
