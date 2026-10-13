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
    expect(summarisePull(pull(1, { isDraft: true }), null).mergeStatus).toBe('UNKNOWN');
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
        // A search's deferred rows come wrapped, keyed by index rather than listed (the shape GitHub's dashboard answers).
        if (url.startsWith('/pulls/deferred')) {
          return Response.json({
            meta: { title: 'Pull requests' },
            payload: { pullsDashboardSurfaceContentDeferredData: { results: { '0': { id: 'PR_9', statusCheckRollup: { state: 'SUCCESS', totalCount: 2, successCount: 2 } } } } },
          });
        }
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
  const row = { repo: widgets, number: 7, state: 'OPEN', isDraft: false, author: { login: 'ana', avatarUrl: '', url: '' }, ci: { state: 'SUCCESS' } } as const;

  it('reads mergeability, why merging is blocked and the reviewers it names from the merge box, line counts from the diffstat', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        if (url.includes('/page_data/merge_box')) {
          return Response.json({
            pullRequest: { mergeStateStatus: 'BLOCKED', latestOpinionatedReviews: [{ author: { login: 'bo', avatarUrl: 'https://avatars/bo' }, state: 'APPROVED' }] },
            mergeRequirements: { conditions: [{ type: 'PULL_REQUEST_RULES', result: 'FAILED', displayName: 'Rules', message: 'At least 2 approving reviews are required' }] },
            reviewerSection: { pendingRequestedReviews: [{ reviewer: { login: 'cy', avatarUrl: 'https://avatars/cy' }, isCodeOwner: false }] },
          });
        }
        // Signed out, review_requests names nobody.
        if (url.includes('/page_data/review_requests')) return Response.json({});
        return Response.json({ diffstat: { linesAdded: 12, linesDeleted: 3, linesChanged: 15 } });
      }),
    );
    expect(await enrichPull(row, 'SQUASH', 'bo')).toEqual({
      mergeStatus: 'BLOCKED',
      mergeBlockedReason: 'At least 2 approving reviews are required',
      reviewers: [
        { kind: 'user', user: { login: 'cy', avatarUrl: 'https://avatars/cy', url: 'https://github.com/cy' }, state: 'PENDING', id: undefined, canReRequest: false },
        { kind: 'user', user: { login: 'bo', avatarUrl: 'https://avatars/bo', url: 'https://github.com/bo' }, state: 'APPROVED' },
      ],
      viewerReview: 'APPROVED',
      additions: 12,
      deletions: 3,
    });
    expect(requested.sort()).toEqual([
      '/acme/widgets/pull/7/page_data/diffstat',
      '/acme/widgets/pull/7/page_data/merge_box?merge_method=SQUASH&bypass_requirements=false',
      '/acme/widgets/pull/7/page_data/review_requests',
      '/acme/widgets/pull/7/page_data/status_checks',
    ]);
  });

  it("names the reviewers, bots and teams too, and the viewer's own review, from the review requests", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/page_data/review_requests')) {
          return Response.json({
            pendingReviewRequests: [{ reviewer: { id: 7, displayLogin: 'acme/parcs', avatarUrl: '', reviewerType: 'Team' } }],
            completedReviews: [
              { reviewer: { id: 1, displayLogin: 'octocat', avatarUrl: 'https://avatars/octocat' }, state: 'APPROVED', submittedAt: '2026-10-02T00:00:00Z' },
              { reviewer: { id: 2, displayLogin: 'Copilot', avatarUrl: 'https://avatars/in/946600' }, state: 'COMMENTED', submittedAt: '2026-10-01T00:00:00Z' },
            ],
          });
        }
        if (url.includes('/page_data/merge_box')) return Response.json({ pullRequest: { mergeStateStatus: 'CLEAN' } });
        return Response.json({ diffstat: { linesAdded: 1, linesDeleted: 1 } });
      }),
    );
    const found = await enrichPull(row, 'MERGE', 'OctoCat');
    expect(found.reviewers?.map((reviewer) => [reviewer.user.login, reviewer.kind, reviewer.state])).toEqual([
      ['acme/parcs', 'team', 'PENDING'],
      ['Copilot', 'user', 'COMMENTED'],
      ['octocat', 'user', 'APPROVED'],
    ]);
    expect(found).toMatchObject({ mergeStatus: 'CLEAN', viewerReview: 'APPROVED' });
    expect(found).not.toHaveProperty('mergeBlockedReason');
  });

  it("names an open PR's branches from its merge box, and only the base of a fork's", async () => {
    let isCrossRepo = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/page_data/merge_box')
          ? Response.json({ pullRequest: { mergeStateStatus: 'CLEAN', headRefName: 'nat/booking-date-picker', baseRefName: 'nat/date-picker', isCrossRepo } })
          : Response.json({}),
      ),
    );
    expect(await enrichPull(row, 'MERGE', null)).toMatchObject({ headRefName: 'nat/booking-date-picker', baseRefName: 'nat/date-picker' });
    isCrossRepo = true;
    const fork = await enrichPull(row, 'MERGE', null);
    expect(fork.baseRefName).toBe('nat/date-picker');
    expect(fork).not.toHaveProperty('headRefName');
  });

  it('asks a failing rollup which checks fail and which of them are required', async () => {
    const requested: string[] = [];
    let marked = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        if (url.includes('/page_data/status_checks')) {
          return Response.json({
            statusChecks: [
              { displayName: 'build', state: 'SUCCESS', ...(marked && { isRequired: true }) },
              { displayName: 'preview', state: 'FAILURE', ...(marked && { isRequired: false }) },
            ],
          });
        }
        return Response.json({});
      }),
    );
    const failing = { ...row, ci: { state: 'FAILURE' } } as const;
    expect(await enrichPull(failing, 'MERGE', null)).toMatchObject({
      ci: { state: 'FAILURE', checks: [{ name: 'build', state: 'SUCCESS' }, { name: 'preview', state: 'FAILURE' }], counts: { success: 1, failure: 1 } },
      requiredCheckNames: ['build'],
    });
    expect(requested).toContain('/acme/widgets/pull/7/page_data/status_checks');
    // Rows that do not say which checks are required leave that unknown.
    marked = false;
    expect(await enrichPull(failing, 'MERGE', null)).not.toHaveProperty('requiredCheckNames');
    requested.length = 0;
    await enrichPull({ ...row, state: 'MERGED' }, 'MERGE', null);
    expect(requested.some((url) => url.includes('status_checks'))).toBe(false);
  });

  it("counts a failed run of GitHub's own Copilot review on the head commit, which a passed rollup leaves out, as an optional failure", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        if (url.includes('/page_data/merge_box')) return Response.json({ pullRequest: { mergeStateStatus: 'CLEAN', headRefName: 'feat/review', headRefOid: `9824bb7${'0'.repeat(33)}` } });
        if (url.includes('/page_data/status_checks')) return Response.json({ statusChecks: [{ displayName: 'build', state: 'SUCCESS', isRequired: false }] });
        if (url.startsWith('/acme/widgets/actions?')) {
          return new Response(
            `<ul><li aria-label="failed: Run 2557 of Copilot. Running Copilot Code Review"><a href="https://github.com/acme/widgets/actions/runs/31">Running Copilot Code Review</a><relative-time datetime="2026-10-12T19:43:25.000Z"></relative-time></li></ul>`,
            { headers: { 'content-type': 'text/html' } },
          );
        }
        if (url === '/acme/widgets/actions/runs/31') return new Response('<title>Running Copilot Code Review · acme/widgets@9824bb7</title>', { headers: { 'content-type': 'text/html' } });
        return Response.json({});
      }),
    );
    const found = await enrichPull({ ...row, number: 10 }, 'MERGE', null);
    expect(found.ci?.state).toBe('FAILURE');
    expect(found.ci?.checks.map((check) => check.name)).toEqual(['build', 'Copilot / Running Copilot Code Review']);
    expect(found.requiredCheckNames).toEqual([]);
    expect(requested).toContain('/acme/widgets/actions?query=branch%3Afeat%2Freview+event%3Adynamic');
  });

  it("asks a pending rollup its checks, since Graphite's mergeability check keeps a stacked PR's rollup pending", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/page_data/status_checks')
          ? Response.json({ statusChecks: [{ displayName: 'build', state: 'SUCCESS', isRequired: true }, { displayName: 'Graphite / mergeability_check', state: 'PENDING' }] })
          : Response.json({}),
      ),
    );
    expect(await enrichPull({ ...row, ci: { state: 'PENDING' } }, 'MERGE', null)).toMatchObject({
      ci: { state: 'SUCCESS', checks: [{ name: 'build', state: 'SUCCESS' }], counts: { success: 1, failure: 0, pending: 0 } },
      requiredCheckNames: ['build'],
    });
  });

  it.each([
    ['a merged pull request', { state: 'MERGED', isDraft: false }, { additions: 4, deletions: 1 }],
    ['a closed pull request', { state: 'CLOSED', isDraft: false }, { additions: 4, deletions: 1 }],
  ] as const)('asks no merge box for %s', async (_, pr, found) => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        return Response.json(url.includes('diffstat') ? { diffstat: { linesAdded: 4, linesDeleted: 1 } } : {});
      }),
    );
    expect(await enrichPull({ ...row, number: 8, ...pr }, 'MERGE', null)).toEqual(found);
    expect(requested.sort()).toEqual(['/acme/widgets/pull/8/page_data/diffstat', '/acme/widgets/pull/8/page_data/review_requests']);
  });

  it('leaves out what GitHub refuses, and reviewers nobody names', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/merge_box') ? Response.json({ mergeRequirements: { state: 'MERGEABLE', conditions: [] } }) : new Response('', { status: 500 }),
      ),
    );
    expect(await enrichPull({ ...row, number: 9 }, 'MERGE', null)).toEqual({ mergeStatus: 'CLEAN' });
    expect(console.debug).toHaveBeenCalledWith('[gg]', expect.stringContaining('page_data/diffstat for acme/widgets#9 failed'), 'GitHub answered 500 for /acme/widgets/pull/9/page_data/diffstat');

    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/diffstat') ? Response.json({ diffstat: { linesAdded: 1, linesDeleted: 0 } }) : new Response('', { status: 404 }))));
    expect(await enrichPull({ ...row, number: 9 }, 'MERGE', null)).toEqual({ additions: 1, deletions: 0 });
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
