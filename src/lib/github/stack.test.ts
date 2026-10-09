import { describe, expect, it } from 'vitest';
import type { PrSummary } from '../model';
import { resolveStack, stackFromGraphiteComment, type BranchPullRequest, type StackLookups } from './stack';

describe('resolveStack from branches', () => {
  it('orders a linear stack from trunk up, wherever the viewed PR sits', async () => {
    const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b'), pr(3, 'b', 'c')];
    const stack = await resolveStack(subject(prs[1]!), lookups(prs));
    expect(stack.entries.map((entry) => entry.number)).toEqual([1, 2, 3]);
    expect(stack).toMatchObject({ currentIndex: 1, trunk: 'main', source: 'branches' });
  });

  it('leaves a lone PR on its own', async () => {
    const prs = [pr(5, 'main', 'x'), pr(6, 'main', 'y')];
    const stack = await resolveStack(subject(prs[0]!), lookups(prs));
    expect(stack).toMatchObject({ entries: [{ number: 5 }], currentIndex: 0, trunk: 'main', source: 'none' });
  });

  it('follows only the most recently updated child where the stack branches', async () => {
    const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b', { updatedAt: '2026-10-01T00:00:00Z' }), pr(3, 'a', 'c', { updatedAt: '2026-10-05T00:00:00Z' }), pr(4, 'c', 'd')];
    const stack = await resolveStack(subject(prs[0]!), lookups(prs));
    expect(stack.entries.map((entry) => entry.number)).toEqual([1, 3]);
  });

  it('keeps a merged PR below, but prefers an open parent over a newer merged one', async () => {
    const landed = [pr(1, 'main', 'a', { state: 'MERGED' }), pr(2, 'a', 'b')];
    expect((await resolveStack(subject(landed[1]!), lookups(landed))).entries.map((entry) => [entry.number, entry.state])).toEqual([
      [1, 'MERGED'],
      [2, 'OPEN'],
    ]);

    const reopened = [pr(1, 'main', 'a', { state: 'MERGED', updatedAt: '2026-10-08T00:00:00Z' }), pr(6, 'main', 'a', { updatedAt: '2026-10-01T00:00:00Z' }), pr(2, 'a', 'b')];
    expect((await resolveStack(subject(reopened[2]!), lookups(reopened))).entries.map((entry) => entry.number)).toEqual([6, 2]);
  });

  it('uses the native stack when GitHub has one', async () => {
    const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b')];
    const native = { trunk: 'main', entries: prs.map(summary) };
    const self = { ...summary(prs[1]!), nativeStack: { position: 2, size: 2 } };
    const stack = await resolveStack({ ...subject(prs[1]!), summary: self }, { ...lookups(prs), nativeStack: async () => native });
    expect(stack).toMatchObject({ currentIndex: 1, trunk: 'main', source: 'native' });
  });
});

describe("Graphite's stack comment", () => {
  const comment = [
    '* **#4540** <a href="https://app.graphite.com/github/pr/acme/widgets/4540"><img src="x"/></a>',
    '* **#4538** <a href="https://app.graphite.com/github/pr/acme/widgets/4538"><img src="x"/></a> 👈 <a href="#">(View in Graphite)</a>',
    '* **#4531** <a href="https://app.graphite.com/github/pr/acme/widgets/4531"><img src="x"/></a>',
    '* `staging`',
    '<hr />',
    'This stack of pull requests is managed by <a href="https://graphite.dev?utm-source=stack-comment"><b>Graphite</b></a>.',
    '<!-- Current dependencies on/for this PR: -->',
  ].join('\r\n');

  it('parses the PRs bottom-up and the trunk', () => {
    expect(stackFromGraphiteComment(comment)).toEqual({ numbers: [4531, 4538, 4540], trunk: 'staging' });
    expect(stackFromGraphiteComment('* **#12** looks like a list but is not the stack comment')).toBeNull();
  });

  it('orders the stack by the comment when the branches say nothing', async () => {
    const prs = [pr(4531, 'staging', 'x'), pr(4538, 'staging', 'y'), pr(4540, 'staging', 'z')];
    const stack = await resolveStack({ ...subject(prs[1]!), texts: ['', comment] }, lookups(prs));
    expect(stack.entries.map((entry) => entry.number)).toEqual([4531, 4538, 4540]);
    expect(stack).toMatchObject({ currentIndex: 1, trunk: 'staging', source: 'graphite-comment' });
  });
});

function pr(number: number, base: string, head: string, overrides: Partial<BranchPullRequest> = {}): BranchPullRequest {
  return { number, state: 'OPEN', updatedAt: '2026-10-01T00:00:00Z', headRefName: head, baseRefName: base, isCrossRepository: false, ...overrides };
}

function subject(self: BranchPullRequest) {
  return { summary: summary(self), defaultBranch: 'main', isCrossRepository: false, texts: [] };
}

/** Lookups over an in-memory repository: `prs` are all its pull requests. */
function lookups(prs: BranchPullRequest[]): StackLookups {
  return {
    nativeStack: async () => null,
    pullRequestsWithHead: async (branch) => prs.filter((p) => p.headRefName === branch && p.state !== 'CLOSED'),
    openPullRequestsOnto: async (branch) => prs.filter((p) => p.baseRefName === branch && p.state === 'OPEN'),
    summaries: async (numbers) => numbers.flatMap((number) => prs.filter((p) => p.number === number).map(summary)),
  };
}

function summary(p: BranchPullRequest): PrSummary {
  return {
    id: `PR_${p.number}`,
    repo: { owner: 'acme', name: 'widgets' },
    number: p.number,
    title: `PR ${p.number}`,
    url: `https://github.com/acme/widgets/pull/${p.number}`,
    author: { login: 'octocat', avatarUrl: '', url: 'https://github.com/octocat' },
    state: p.state,
    isDraft: false,
    createdAt: p.updatedAt,
    updatedAt: p.updatedAt,
    mergedAt: null,
    headRefName: p.headRefName,
    baseRefName: p.baseRefName,
    reviewDecision: 'NONE',
    reviewers: [],
    ci: { state: 'NONE', checks: [], counts: { success: 0, failure: 0, pending: 0, other: 0 } },
    mergeStatus: 'CLEAN',
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    labels: [],
    commentCount: 0,
    unread: null,
    isInMergeQueue: false,
    autoMerge: null,
    nativeStack: null,
  };
}
