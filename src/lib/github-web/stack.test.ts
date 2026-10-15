import { describe, expect, it } from 'vitest';
import type { PrSummary } from '../model';
import { githubUser } from './session';
import { authorHeaderAnswer, authorIn, graphiteStackComment, resolveStack } from './stack';

const noLookups = { mergeability: async () => null, authorsOpenPulls: async () => [], conversations: async () => null, author: async () => null };

describe('native stacks', () => {
  it('orders the stack from trunk up (GitHub lists the top first) and chains the branches', async () => {
    const current = summary(2, 'b');
    const stack = await resolveStack(
      {
        current,
        page: emptyPage(),
        nativeStack: {
          baseBranch: 'main',
          position: 2,
          size: 3,
          pulls: [
            { number: 3, title: 'Top', state: 'DRAFT', url: '/o/r/pull/3', headBranch: 'c' },
            { number: 2, title: 'Middle', state: 'OPEN', url: '/o/r/pull/2', headBranch: 'b' },
            { number: 1, title: 'Bottom', state: 'MERGED', url: '/o/r/pull/1', headBranch: 'a' },
          ],
        },
      },
      { ...noLookups, mergeability: async () => [{ pull: { number: 3 }, status: 'MERGEABLE' }] },
    );
    expect(stack).toMatchObject({ currentIndex: 1, trunk: 'main', source: 'native' });
    expect(stack.entries[1]).toBe(current);
    expect(stack.entries.map((entry) => [entry.number, entry.state, entry.isDraft, entry.baseRefName, entry.headRefName])).toEqual([
      [1, 'MERGED', false, 'main', 'a'],
      [2, 'OPEN', false, 'main', 'b'],
      [3, 'OPEN', true, 'b', 'c'],
    ]);
    expect(stack.entries[0]).toMatchObject({ url: 'https://github.com/o/r/pull/1', nativeStack: { position: 1, size: 3 } });
    expect(stack.entries[2]?.mergeStatus).toBe('DRAFT');
  });

  it("counts every other entry's conversations from its own threads, three at a time, and leaves the viewed PR's to the page", async () => {
    const current = summary(2, 'b2');
    const asked: number[] = [];
    let inFlight = 0;
    let mostInFlight = 0;
    const stack = await resolveStack(
      {
        current,
        page: emptyPage(),
        nativeStack: {
          baseBranch: 'main',
          position: 2,
          size: 6,
          pulls: [6, 5, 4, 3, 2, 1].map((number) => ({ number, title: `PR ${number}`, state: 'OPEN', url: `/o/r/pull/${number}`, headBranch: `b${number}` })),
        },
      },
      {
        ...noLookups,
        conversations: async (number) => {
          asked.push(number);
          mostInFlight = Math.max(mostInFlight, ++inFlight);
          await new Promise((resolve) => setTimeout(resolve, 1));
          inFlight--;
          return { resolved: number - 1, total: number };
        },
      },
    );
    expect(stack.entries[1]).toBe(current);
    expect(stack.entries.map((entry) => entry.conversations)).toEqual([
      { resolved: 0, total: 1 },
      null,
      { resolved: 2, total: 3 },
      { resolved: 3, total: 4 },
      { resolved: 4, total: 5 },
      { resolved: 5, total: 6 },
    ]);
    expect(asked.toSorted()).toEqual([1, 3, 4, 5, 6]);
    expect(mostInFlight).toBe(3);
  });

  it("gives every other entry the author its own page header names, and none where GitHub did not answer, never the viewed PR's", async () => {
    const current = summary(2, 'b');
    const asked: number[] = [];
    const stack = await resolveStack(
      {
        current,
        page: emptyPage(),
        nativeStack: {
          baseBranch: 'main',
          position: 2,
          size: 3,
          pulls: [3, 2, 1].map((number) => ({ number, title: `PR ${number}`, state: 'OPEN', url: `/o/r/pull/${number}`, headBranch: `b${number}` })),
        },
      },
      {
        ...noLookups,
        author: async (number) => {
          asked.push(number);
          return number === 3 ? githubUser('riley') : null;
        },
      },
    );
    expect(stack.entries[1]).toBe(current);
    expect(stack.entries.map((entry) => entry.author?.login ?? null)).toEqual([null, 'ana', 'riley']);
    expect(asked.toSorted()).toEqual([1, 3]);
  });
});

describe("a stack entry's author", () => {
  it('is who its page header says opened the PR, a bot the way GitHub names it, and nobody for a header without the PR', () => {
    expect(authorIn(authorHeaderAnswer.parse({ pullRequest: { author: { isAgent: false, slug: 'riley', login: 'riley', displayName: 'Riley', avatarUrl: 'https://avatars.githubusercontent.com/u/7?v=4' } } }))).toEqual({
      login: 'riley',
      avatarUrl: 'https://avatars.githubusercontent.com/u/7?v=4',
      url: 'https://github.com/riley',
    });
    expect(authorIn(authorHeaderAnswer.parse({ pullRequest: { author: { isAgent: true, login: 'app/dependabot' } } }))?.login).toBe('app/dependabot');
    // A deleted account, as the PR's own page shows it.
    expect(authorIn(authorHeaderAnswer.parse({ pullRequest: { author: null } }))?.login).toBe('ghost');
    expect(authorIn(authorHeaderAnswer.parse({ stack: null }))).toBeNull();
  });
});

describe("Graphite's stack comment", () => {
  // As GitHub renders Graphite's comment: reference links with the PR title and a state icon, the trunk in code.
  const page = new DOMParser().parseFromString(
    `<html><body><div class="timeline-comment-group" id="issuecomment-1"><div class="comment-body">
      <ul>
        <li><strong><span class="reference"><svg class="octicon octicon-git-pull-request open"></svg><a class="issue-link" href="https://github.com/o/r/pull/29">Layer 3<span class="issue-shorthand">&nbsp;#29</span></a></span></strong></li>
        <li><strong><span class="reference"><svg class="octicon octicon-git-pull-request open"></svg><a class="issue-link" href="https://github.com/o/r/pull/26">Layer 2<span class="issue-shorthand">&nbsp;#26</span></a></span></strong> 👈</li>
        <li><strong><span class="reference"><svg class="octicon octicon-git-merge"></svg><a class="issue-link" href="https://github.com/o/r/pull/22">Layer 1<span class="issue-shorthand">&nbsp;#22</span></a></span></strong></li>
        <li><code>main</code></li>
      </ul>
      <p>This stack of pull requests is managed by <a href="https://graphite.dev"><b>Graphite</b></a>.</p>
    </div></div></body></html>`,
    'text/html',
  );

  it('reads the PRs bottom-up with their titles and states, and the trunk', () => {
    expect(graphiteStackComment(page)).toEqual({
      entries: [
        { number: 22, title: 'Layer 1', url: 'https://github.com/o/r/pull/22', state: 'MERGED', isDraft: false },
        { number: 26, title: 'Layer 2', url: 'https://github.com/o/r/pull/26', state: 'OPEN', isDraft: false },
        { number: 29, title: 'Layer 3', url: 'https://github.com/o/r/pull/29', state: 'OPEN', isDraft: false },
      ],
      trunk: 'main',
    });
    expect(graphiteStackComment(emptyPage())).toBeNull();
  });

  it("orders the stack by the comment, using the author's open PRs where the search has them, and asks who opened the others", async () => {
    const current = summary(26, 'layer-2');
    const fromSearch = summary(29, 'layer-3');
    const asked: number[] = [];
    const stack = await resolveStack(
      { current, page, nativeStack: null },
      {
        ...noLookups,
        authorsOpenPulls: async () => [fromSearch],
        author: async (number) => {
          asked.push(number);
          return githubUser('riley');
        },
      },
    );
    expect(stack).toMatchObject({ currentIndex: 1, trunk: 'main', source: 'graphite-comment' });
    expect(stack.entries[2]).toEqual(fromSearch);
    expect(stack.entries[0]).toMatchObject({ number: 22, title: 'Layer 1', state: 'MERGED', author: { login: 'riley' } });
    expect(asked).toEqual([22]);
  });
});

it('leaves an unstacked PR on its own', async () => {
  const current = summary(5, 'feature');
  expect(await resolveStack({ current, page: emptyPage(), nativeStack: null }, noLookups)).toEqual({ entries: [current], currentIndex: 0, trunk: 'main', source: 'none' });
});

function emptyPage(): Document {
  return new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
}

function summary(number: number, head: string): PrSummary {
  return {
    id: `PR_${number}`,
    repo: { owner: 'o', name: 'r' },
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    author: { login: 'ana', avatarUrl: '', url: 'https://github.com/ana' },
    state: 'OPEN',
    isDraft: false,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    mergedAt: null,
    headRefName: head,
    baseRefName: 'main',
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
