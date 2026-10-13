import { describe, expect, it } from 'vitest';
import type { PrSummary } from '../lib/model';
import { rowsByStack } from './stacks';

describe('rowsByStack', () => {
  it("puts a stack's rows together where the first of them sorts, the top first, and leaves the other rows in their places", () => {
    const prs = [pr(10, 'x', 'main'), pr(2, 'b', 'a'), pr(11, 'y', 'main'), pr(1, 'a', 'main'), pr(3, 'c', 'b')];
    expect(rowsByStack(prs, prs).map((row) => [row.pr.number, row.stacked])).toEqual([
      [10, false],
      [3, false],
      [2, true],
      [1, true],
      [11, false],
    ]);
  });

  it('joins a stack through a PR only another section shows', () => {
    const bottom = pr(1, 'a', 'main');
    const top = pr(3, 'c', 'b');
    expect(rowsByStack([bottom, top], [bottom, pr(2, 'b', 'a'), top]).map((row) => [row.pr.number, row.stacked])).toEqual([
      [3, false],
      [1, true],
    ]);
  });

  it('leaves rows whose branches are not known yet, or a fork whose head branch is not, as they are', () => {
    const prs = [pr(5, '', ''), pr(6, '', 'a'), pr(1, 'a', 'main')];
    expect(rowsByStack(prs, prs).map((row) => [row.pr.number, row.stacked])).toEqual([
      [5, false],
      [6, false],
      [1, false],
    ]);
  });

  it('chains branches within one repository only, its name in any case', () => {
    const prs = [pr(1, 'a', 'main'), pr(2, 'b', 'a', 'acme/api'), pr(3, 'c', 'a', 'Acme/Widgets')];
    expect(rowsByStack(prs, prs).map((row) => [row.pr.number, row.stacked])).toEqual([
      [3, false],
      [1, true],
      [2, false],
    ]);
  });

  it('groups two PRs on the same base under the higher one', () => {
    // 1 ← 2 ← 4, and 1 ← 3.
    const prs = [pr(3, 'c', 'a'), pr(1, 'a', 'main'), pr(4, 'd', 'b'), pr(2, 'b', 'a')];
    expect(rowsByStack(prs, prs).map((row) => [row.pr.number, row.stacked])).toEqual([
      [4, false],
      [3, true],
      [2, true],
      [1, true],
    ]);
  });
});

function pr(number: number, head: string, base: string, repo = 'acme/widgets'): PrSummary {
  const [owner = '', name = ''] = repo.split('/');
  return {
    id: `PR_${repo}_${number}`,
    repo: { owner, name },
    number,
    title: `PR ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    author: { login: 'ana', avatarUrl: '', url: 'https://github.com/ana' },
    state: 'OPEN',
    isDraft: false,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    mergedAt: null,
    headRefName: head,
    baseRefName: base,
    reviewDecision: 'NONE',
    reviewers: [],
    ci: { state: 'NONE', checks: [], counts: { success: 0, failure: 0, pending: 0, other: 0 } },
    mergeStatus: 'UNKNOWN',
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
