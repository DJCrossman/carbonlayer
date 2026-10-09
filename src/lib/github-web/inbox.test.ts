import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchInbox, summarisePull, type Pull } from './inbox';

afterEach(() => vi.unstubAllGlobals());

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

  it('accepts a bare list of rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.startsWith('/pulls/inbox/queries') ? Response.json([pull(4)]) : Response.json([]))),
    );
    const [result] = await fetchInbox([{ id: 'a', name: 'Drafts', query: 'inbox:your-drafts' }], '');
    expect(result).toMatchObject({ totalCount: 1, prs: [{ number: 4 }] });
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
