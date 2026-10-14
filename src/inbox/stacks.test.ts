import { describe, expect, it } from 'vitest';
import type { PrSummary } from '../lib/model';
import { rowsByStack, stackPlaces } from './stacks';

describe('rowsByStack', () => {
  it("puts a stack's rows together where the first of them sorts, the top first, and leaves the other rows in their places", () => {
    const prs = [pr(10, 'x', 'main'), pr(2, 'b', 'a'), pr(11, 'y', 'main'), pr(1, 'a', 'main'), pr(3, 'c', 'b')];
    expect(rowsByStack(prs, stackPlaces(prs)).map((row) => [row.pr.number, row.stacked])).toEqual([
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
    expect(rowsByStack([bottom, top], stackPlaces([bottom, pr(2, 'b', 'a'), top])).map((row) => [row.pr.number, row.stacked])).toEqual([
      [3, false],
      [1, true],
    ]);
  });

  it('leaves rows whose branches are not known yet, or a fork whose head branch is not, as they are', () => {
    const prs = [pr(5, '', ''), pr(6, '', 'a'), pr(1, 'a', 'main')];
    expect(rowsByStack(prs, stackPlaces(prs)).map((row) => [row.pr.number, row.stacked])).toEqual([
      [5, false],
      [6, false],
      [1, false],
    ]);
  });

  it('chains branches within one repository only, its name in any case', () => {
    const prs = [pr(1, 'a', 'main'), pr(2, 'b', 'a', 'acme/api'), pr(3, 'c', 'a', 'Acme/Widgets')];
    expect(rowsByStack(prs, stackPlaces(prs)).map((row) => [row.pr.number, row.stacked])).toEqual([
      [3, false],
      [1, true],
      [2, false],
    ]);
  });

  it('groups two PRs on the same base under the higher one', () => {
    // 1 ← 2 ← 4, and 1 ← 3.
    const prs = [pr(3, 'c', 'a'), pr(1, 'a', 'main'), pr(4, 'd', 'b'), pr(2, 'b', 'a')];
    expect(rowsByStack(prs, stackPlaces(prs)).map((row) => [row.pr.number, row.stacked])).toEqual([
      [4, false],
      [3, true],
      [2, true],
      [1, true],
    ]);
  });
});

describe('stackPlaces', () => {
  it('counts a chain up from its bottom-most known PR, 1, and gives a row in no stack no place', () => {
    const [top, bottom, middle, alone] = [pr(3, 'c', 'b'), pr(1, 'a', 'main'), pr(2, 'b', 'a'), pr(9, 'z', 'main')];
    expect(stackPlaces([top, bottom, middle, alone])).toEqual(
      new Map([
        [bottom.id, { bottomId: bottom.id, position: 1, size: 3, untracked: true }],
        [middle.id, { bottomId: bottom.id, position: 2, size: 3, untracked: true }],
        [top.id, { bottomId: bottom.id, position: 3, size: 3, untracked: true }],
      ]),
    );
  });

  it("sizes a fork's PR by its own line: those below it and the tallest line above it", () => {
    // 1 ← 2 ← 4, and 1 ← 3.
    const [one, two, three, four] = [pr(1, 'a', 'main'), pr(2, 'b', 'a'), pr(3, 'c', 'a'), pr(4, 'd', 'b')];
    expect(stackPlaces([three, one, four, two])).toEqual(
      new Map([
        [one.id, { bottomId: one.id, position: 1, size: 3, untracked: true }],
        [two.id, { bottomId: one.id, position: 2, size: 3, untracked: true }],
        [three.id, { bottomId: one.id, position: 2, size: 2, untracked: true }],
        [four.id, { bottomId: one.id, position: 3, size: 3, untracked: true }],
      ]),
    );
  });

  it('chains through a PR only another section shows, and counts a PR two sections show once', () => {
    const [bottom, middle, top] = [pr(1, 'a', 'main'), pr(2, 'b', 'a'), pr(3, 'c', 'b')];
    // One section shows the bottom and the top, another the middle and the bottom again.
    expect(stackPlaces([bottom, top, middle, bottom])).toEqual(
      new Map([
        [bottom.id, { bottomId: bottom.id, position: 1, size: 3, untracked: true }],
        [middle.id, { bottomId: bottom.id, position: 2, size: 3, untracked: true }],
        [top.id, { bottomId: bottom.id, position: 3, size: 3, untracked: true }],
      ]),
    );
  });

  it("leaves rows in GitHub's own stacks to GitHub's chip", () => {
    const native = [
      { ...pr(1, 'a', 'main'), nativeStack: { position: 1, size: 2 } },
      { ...pr(2, 'b', 'a'), nativeStack: { position: 2, size: 2 } },
    ];
    const graphiteOnly = [pr(5, 'e', 'main'), pr(6, 'f', 'e')];
    const places = stackPlaces([...native, ...graphiteOnly]);
    expect([...native, ...graphiteOnly].map((row) => [row.number, places.get(row.id)?.untracked])).toEqual([
      [1, false],
      [2, false],
      [5, true],
      [6, true],
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
    conversations: null,
  };
}
