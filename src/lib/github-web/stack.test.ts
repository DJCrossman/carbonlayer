import { assert, describe, expect, it } from 'vitest';
import type { PrSummary } from '../model';
import { authorHeaderAnswer, authorIn, graphiteStackComment, graphiteStackPlace, resolveStack, stackMergeabilityAnswer } from './stack';

const noLookups = { mergeability: async () => null, authorsOpenPulls: async () => [], conversations: async () => null, header: async () => null };

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
      noLookups,
    );
    expect(stack).toMatchObject({ currentIndex: 1, trunk: 'main', source: 'native' });
    expect(stack.entries[1]).toEqual({ ...current, parentNumber: 1, readyToMergeAsStack: false });
    expect(stack.entries.map((entry) => [entry.number, entry.state, entry.isDraft, entry.baseRefName, entry.headRefName])).toEqual([
      [1, 'MERGED', false, 'main', 'a'],
      [2, 'OPEN', false, 'main', 'b'],
      [3, 'OPEN', true, 'b', 'c'],
    ]);
    // Each on the one below it, the bottom one on trunk; GitHub's stack is one line.
    expect(stack.entries.map((entry) => entry.parentNumber)).toEqual([null, 1, 2]);
    expect(stack.forks).toEqual([]);
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
    expect(stack.entries[1]).toEqual({ ...current, parentNumber: 1, readyToMergeAsStack: false });
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
        header: async (number) => {
          asked.push(number);
          return number === 3 ? authorHeaderAnswer.parse({ pullRequest: { author: { login: 'riley' } } }) : null;
        },
      },
    );
    expect(stack.entries[1]).toEqual({ ...current, parentNumber: 1, readyToMergeAsStack: false });
    expect(stack.entries.map((entry) => entry.author?.login ?? null)).toEqual([null, 'ana', 'riley']);
    expect(asked.toSorted()).toEqual([1, 3]);
  });

  it("asks each open PR from the bottom up to the viewed one for GitHub's verdict on merging it as a stack, and no other", async () => {
    const current = summary(3, 'c');
    const asked: number[] = [];
    const stack = await resolveStack(
      {
        current,
        page: emptyPage(),
        nativeStack: {
          baseBranch: 'main',
          position: 3,
          size: 4,
          pulls: [
            { number: 4, title: 'Top', state: 'OPEN', url: '/o/r/pull/4', headBranch: 'd' },
            { number: 3, title: 'Viewed', state: 'OPEN', url: '/o/r/pull/3', headBranch: 'c' },
            { number: 2, title: 'Below', state: 'OPEN', url: '/o/r/pull/2', headBranch: 'b' },
            { number: 1, title: 'Bottom', state: 'MERGED', url: '/o/r/pull/1', headBranch: 'a' },
          ],
        },
      },
      {
        ...noLookups,
        mergeability: async (number) => {
          asked.push(number);
          return stackMergeabilityAnswer.parse(verifiedVerdict);
        },
      },
    );
    expect(asked.toSorted()).toEqual([2, 3]);
    expect(stack.entries.map((entry) => [entry.number, entry.mergeStatus, entry.readyToMergeAsStack])).toEqual([
      [1, 'UNKNOWN', false],
      [2, 'CLEAN', true],
      [3, 'UNKNOWN', true],
      [4, 'UNKNOWN', false],
    ]);
  });

  it('reads only READY as ready to merge as a stack: a status it does not know, or none, is not ready, and nothing fails', async () => {
    const current = summary(3, 'c');
    // What GitHub answers, before it is read.
    const answers = new Map<number, unknown>([
      [1, verifiedVerdict],
      [2, { state: 'UNMERGEABLE', effectiveEntryStatus: 'A_STATUS_GITHUB_ADDS_LATER' }],
      [3, {}],
    ]);
    const stack = await resolveStack(
      {
        current,
        page: emptyPage(),
        nativeStack: {
          baseBranch: 'main',
          position: 3,
          size: 3,
          pulls: [3, 2, 1].map((number) => ({ number, title: `PR ${number}`, state: 'OPEN', url: `/o/r/pull/${number}`, headBranch: `b${number}` })),
        },
      },
      { ...noLookups, mergeability: async (number) => stackMergeabilityAnswer.parse(answers.get(number)) },
    );
    expect(stack.entries.map((entry) => [entry.number, entry.mergeStatus, entry.readyToMergeAsStack])).toEqual([
      [1, 'CLEAN', true],
      [2, 'UNKNOWN', false],
      [3, 'UNKNOWN', false],
    ]);
  });
});

describe("GitHub's verdict on merging a PR as a stack", () => {
  it('is read from the answer GitHub gives each PR, and an answer of another shape fails', () => {
    expect(stackMergeabilityAnswer.parse(verifiedVerdict)).toEqual({ state: 'MERGEABLE', effectiveEntryStatus: 'READY' });
    expect(() => stackMergeabilityAnswer.parse([{ pull: { number: 1 }, status: 'MERGEABLE' }])).toThrow();
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
        { number: 22, title: 'Layer 1', url: 'https://github.com/o/r/pull/22', state: 'MERGED', isDraft: false, parentNumber: null },
        { number: 26, title: 'Layer 2', url: 'https://github.com/o/r/pull/26', state: 'OPEN', isDraft: false, parentNumber: 22 },
        { number: 29, title: 'Layer 3', url: 'https://github.com/o/r/pull/29', state: 'OPEN', isDraft: false, parentNumber: 26 },
      ],
      forks: [],
      trunk: 'main',
    });
    expect(graphiteStackComment(emptyPage())).toBeNull();
  });

  it("reads a PR that branches off the line, which the item of the entry it branches from names, as a fork off that entry (core#9029's comment)", () => {
    expect(graphiteStackComment(forked9029)).toEqual({
      entries: [
        { number: 8994, title: 'Layer 1', url: 'https://github.com/o/r/pull/8994', state: 'OPEN', isDraft: false, parentNumber: null },
        { number: 9002, title: 'Layer 2', url: 'https://github.com/o/r/pull/9002', state: 'OPEN', isDraft: false, parentNumber: 8994 },
        { number: 9001, title: 'Layer 3', url: 'https://github.com/o/r/pull/9001', state: 'OPEN', isDraft: false, parentNumber: 9002 },
        { number: 9004, title: 'Layer 4', url: 'https://github.com/o/r/pull/9004', state: 'OPEN', isDraft: false, parentNumber: 9001 },
        { number: 9026, title: 'Layer 5', url: 'https://github.com/o/r/pull/9026', state: 'OPEN', isDraft: false, parentNumber: 9004 },
        { number: 9029, title: 'Layer 6', url: 'https://github.com/o/r/pull/9029', state: 'OPEN', isDraft: false, parentNumber: 9026 },
      ],
      // A plain link, which says nothing of the PR but its number.
      forks: [{ number: 9003, title: '#9003', url: 'https://github.com/o/r/pull/9003', state: 'OPEN', isDraft: false, parentNumber: 8994 }],
      trunk: 'main',
    });
  });

  it("reads a fork off an entry in the middle of the line, past the comment's warning, where GitHub renders the numbers alone (core#9604's comment)", () => {
    const comment = graphiteStackComment(forked9604);
    expect(comment?.entries.map((entry) => [entry.number, entry.title, entry.parentNumber])).toEqual([
      [9528, '#9528', null],
      [9530, '#9530', 9528],
      [9577, '#9577', 9530],
      [9578, '#9578', 9577],
      [9604, '#9604', 9578],
    ]);
    expect(comment?.forks.map((fork) => [fork.number, fork.url, fork.parentNumber])).toEqual([[9291, 'https://github.com/o/r/pull/9291', 9530]]);
    expect(comment?.trunk).toBe('main');
  });

  it("reads the PRs off the top of a line that has more than one, each a fork, and shows them with the line (core#8994's comment)", async () => {
    const current = summary(8994, 'layer-1');
    const forkedTop = new DOMParser().parseFromString(
      `<html><body><div class="timeline-comment-group" id="issuecomment-4"><div class="comment-body">
        <ul dir="auto">
          <li><strong><a class="issue-link js-issue-link" href="https://github.com/o/r/pull/8994">#8994</a></strong> <a href="https://app.graphite.com/github/pr/o/r/8994?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a>: 2  dependent PRs (<a href="https://github.com/o/r/pull/9002" data-hovercard-type="pull_request">#9002</a> <a href="https://app.graphite.com/github/pr/o/r/9002?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a>, <a href="https://github.com/o/r/pull/9003" data-hovercard-type="pull_request">#9003</a> <a href="https://app.graphite.com/github/pr/o/r/9003?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a>) 👈 <a href="https://app.graphite.com/github/pr/o/r/8994?utm_source=stack-comment-view-in-graphite" rel="nofollow">(View in Graphite)</a></li>
          <li><code class="notranslate">main</code></li>
        </ul>
        <h2 dir="auto"></h2>
        <p dir="auto">This stack of pull requests is managed by <a href="https://graphite.dev?utm-source=stack-comment" rel="nofollow"><b>Graphite</b></a>.</p>
      </div></div></body></html>`,
      'text/html',
    );
    const stack = await resolveStack({ current, page: forkedTop, nativeStack: null }, noLookups);
    expect(stack).toMatchObject({ entries: [{ ...current, parentNumber: null }], currentIndex: 0, trunk: 'main', source: 'graphite-comment' });
    expect(stack.forks.map((fork) => [fork.number, fork.parentNumber])).toEqual([
      [9002, 8994],
      [9003, 8994],
    ]);
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
        header: async (number) => {
          asked.push(number);
          return authorHeaderAnswer.parse({ pullRequest: { author: { login: 'riley' } } });
        },
      },
    );
    expect(stack).toMatchObject({ currentIndex: 1, trunk: 'main', source: 'graphite-comment' });
    expect(stack.entries[2]).toEqual({ ...fromSearch, parentNumber: 26 });
    expect(stack.entries[0]).toMatchObject({ number: 22, title: 'Layer 1', state: 'MERGED', author: { login: 'riley' } });
    expect(asked).toEqual([22]);
  });

  it("keeps the viewed PR's line as the stack's entries and puts a fork beside them, from the author's open PRs where the search has it", async () => {
    const current = summary(9029, 'layer-6');
    const fromSearch = summary(9003, 'layer-2b');
    const asked: number[] = [];
    const stack = await resolveStack(
      { current, page: forked9029, nativeStack: null },
      {
        ...noLookups,
        authorsOpenPulls: async () => [fromSearch],
        conversations: async (number) => {
          asked.push(number);
          return null;
        },
      },
    );
    expect(stack.entries.map((entry) => entry.number)).toEqual([8994, 9002, 9001, 9004, 9026, 9029]);
    expect(stack).toMatchObject({ currentIndex: 5, source: 'graphite-comment' });
    expect(stack.forks).toEqual([{ ...fromSearch, parentNumber: 8994 }]);
    // A fork's conversations are asked for like any other entry's.
    expect(asked.toSorted()).toEqual([8994, 9001, 9002, 9003, 9004, 9026]);
  });

  it('gives a PR the comment names by its number alone the title and state its own header gives, and keeps those the comment named', async () => {
    const current = summary(9029, 'layer-6');
    const stack = await resolveStack(
      { current, page: forked9029, nativeStack: null },
      { ...noLookups, header: async (number) => authorHeaderAnswer.parse({ pullRequest: { author: { login: 'mona' }, title: `Header's title for ${number}`, state: 'CLOSED' } }) },
    );
    expect(stack.forks).toMatchObject([{ number: 9003, title: "Header's title for 9003", state: 'CLOSED', isDraft: false, author: { login: 'mona' }, parentNumber: 8994 }]);
    // #8994's reference named it, with its open icon.
    expect(stack.entries[0]).toMatchObject({ number: 8994, title: 'Layer 1', state: 'OPEN', author: { login: 'mona' } });
  });

  describe("continuing a lower PR's line above what the comment names, by the branches of the author's open PRs", () => {
    // core#10166's stack: #10166 → #10167 → #10181 → #10182 → #10183 → #10171, the closed #10168 off #10167, and #10200 of
    // the same author on trunk, each with the branches its page header names.
    const branches = new Map([
      [10166, { baseBranch: 'main', headBranch: 'l1' }],
      [10167, { baseBranch: 'l1', headBranch: 'l2' }],
      [10168, { baseBranch: 'l2', headBranch: 'l3b' }],
      [10181, { baseBranch: 'l2', headBranch: 'l3' }],
      [10182, { baseBranch: 'l3', headBranch: 'l4' }],
      [10183, { baseBranch: 'l4', headBranch: 'l5' }],
      [10171, { baseBranch: 'l5', headBranch: 'l6' }],
      [10200, { baseBranch: 'main', headBranch: 'other' }],
    ]);
    const openPulls = [10166, 10167, 10181, 10182, 10183, 10171, 10200].map((number) => summary(number, branches.get(number)?.headBranch ?? ''));
    const headerOf = (number: number) =>
      authorHeaderAnswer.parse({ pullRequest: { author: { login: 'ana' }, ...branches.get(number), headRepositoryOwnerLogin: 'o', headRepositoryName: 'r' } });

    it('continues the line through the named dependent up to the top, keeps the closed one a fork, and leaves a PR on another base out', async () => {
      const current = summary(10166, 'l1');
      const asked: number[] = [];
      const stack = await resolveStack(
        { current, page: graphiteComment([{ number: 10167, dependents: [10168, 10181] }, { number: 10166, viewed: true }]), nativeStack: null },
        {
          ...noLookups,
          authorsOpenPulls: async () => openPulls,
          header: async (number) => {
            asked.push(number);
            return headerOf(number);
          },
        },
      );
      expect(stack.entries.map((entry) => [entry.number, entry.parentNumber])).toEqual([
        [10166, null],
        [10167, 10166],
        [10181, 10167],
        [10182, 10181],
        [10183, 10182],
        [10171, 10183],
      ]);
      expect(stack.entries[5]).toEqual({ ...openPulls[5], parentNumber: 10183, conversations: null });
      expect(stack).toMatchObject({ currentIndex: 0, trunk: 'main', source: 'graphite-comment' });
      expect(stack.forks.map((fork) => [fork.number, fork.parentNumber])).toEqual([[10168, 10167]]);
      // The branches of the author's open PRs the comment does not place, and #10168's author, which the search lacks.
      expect(asked.toSorted()).toEqual([10168, 10171, 10181, 10182, 10183, 10200]);
    });

    it('continues a mid-stack PR\'s line above the dependents its comment names', async () => {
      const current = summary(10181, 'l3');
      const stack = await resolveStack(
        {
          current,
          page: graphiteComment([{ number: 10182, dependents: [10183] }, { number: 10181, viewed: true }, { number: 10167, dependents: [10168] }, { number: 10166 }]),
          nativeStack: null,
        },
        { ...noLookups, authorsOpenPulls: async () => openPulls, header: async (number) => headerOf(number) },
      );
      expect(stack.entries.map((entry) => entry.number)).toEqual([10166, 10167, 10181, 10182, 10183, 10171]);
      expect(stack.currentIndex).toBe(2);
      expect(stack.forks.map((fork) => [fork.number, fork.parentNumber])).toEqual([[10168, 10167]]);
    });

    it('takes the tallest chain where PRs above the line branch, the other child a fork off its parent', async () => {
      const current = summary(10166, 'l1');
      // #10179 sits on #10181 beside #10182, with nothing above it; the lower number loses to the taller chain.
      const forked = new Map([...branches, [10179, { baseBranch: 'l3', headBranch: 'side' }]]);
      const stack = await resolveStack(
        { current, page: graphiteComment([{ number: 10167, dependents: [10168, 10181] }, { number: 10166, viewed: true }]), nativeStack: null },
        {
          ...noLookups,
          authorsOpenPulls: async () => [...openPulls, summary(10179, 'side')],
          header: async (number) => authorHeaderAnswer.parse({ pullRequest: { ...forked.get(number), headRepositoryOwnerLogin: 'o', headRepositoryName: 'r' } }),
        },
      );
      expect(stack.entries.map((entry) => entry.number)).toEqual([10166, 10167, 10181, 10182, 10183, 10171]);
      expect(stack.forks.map((fork) => [fork.number, fork.parentNumber])).toEqual([
        [10168, 10167],
        [10179, 10181],
      ]);
    });

    it("leaves the comment's stack as it is when GitHub answers no header", async () => {
      const current = summary(10166, 'l1');
      const stack = await resolveStack(
        { current, page: graphiteComment([{ number: 10167, dependents: [10168, 10181] }, { number: 10166, viewed: true }]), nativeStack: null },
        { ...noLookups, authorsOpenPulls: async () => openPulls },
      );
      expect(stack.entries.map((entry) => [entry.number, entry.parentNumber])).toEqual([
        [10166, null],
        [10167, 10166],
      ]);
      expect(stack.forks.map((fork) => [fork.number, fork.parentNumber])).toEqual([
        [10168, 10167],
        [10181, 10167],
      ]);
    });

    it("asks no header for the author's other open PRs where the comment names nothing off its line's top", async () => {
      const current = summary(9029, 'layer-6');
      const asked: number[] = [];
      const stack = await resolveStack(
        { current, page: forked9029, nativeStack: null },
        {
          ...noLookups,
          authorsOpenPulls: async () => [current, ...openPulls],
          header: async (number) => {
            asked.push(number);
            return null;
          },
        },
      );
      expect(stack.entries.map((entry) => entry.number)).toEqual([8994, 9002, 9001, 9004, 9026, 9029]);
      // Only the authors the search does not give, as before.
      expect(asked.toSorted()).toEqual([8994, 9001, 9002, 9003, 9004, 9026]);
    });
  });
});

describe("a PR's place in Graphite's stack", () => {
  // Bottom first, as Graphite's comment is read.
  const entries: Parameters<typeof graphiteStackPlace>[0]['entries'] = [
    { number: 22, title: 'Layer 1', url: 'https://github.com/o/r/pull/22', state: 'MERGED', isDraft: false, parentNumber: null },
    { number: 24, title: 'Layer 2', url: 'https://github.com/o/r/pull/24', state: 'CLOSED', isDraft: false, parentNumber: 22 },
    { number: 26, title: 'Layer 3', url: 'https://github.com/o/r/pull/26', state: 'OPEN', isDraft: false, parentNumber: 24 },
    { number: 29, title: 'Layer 4', url: 'https://github.com/o/r/pull/29', state: 'OPEN', isDraft: true, parentNumber: 26 },
  ];

  it('counts it from the bottom among every entry the comment lists, merged and closed ones too', () => {
    expect(graphiteStackPlace({ entries, forks: [] }, 26)).toEqual({ position: 3, size: 4 });
    expect(graphiteStackPlace({ entries, forks: [] }, 22)).toEqual({ position: 1, size: 4 });
  });

  it('counts the PR on its own line, the forks off it left out, as Graphite reads core#9029 6 of 6', () => {
    const comment = graphiteStackComment(forked9029);
    assert.isNotNull(comment);
    expect(graphiteStackPlace(comment, 9029)).toEqual({ position: 6, size: 6 });
    expect(graphiteStackPlace(comment, 8994)).toEqual({ position: 1, size: 6 });
  });

  it('counts a fork on its own line, the entries below it down to trunk and itself, as its own page lists it', () => {
    const comment = graphiteStackComment(forked9029);
    assert.isNotNull(comment);
    expect(graphiteStackPlace(comment, 9003)).toEqual({ position: 2, size: 2 });
    // A fork of the fork continues its line.
    const forked: Parameters<typeof graphiteStackPlace>[0] = {
      ...comment,
      forks: [...comment.forks, { number: 9005, title: '#9005', url: 'https://github.com/o/r/pull/9005', state: 'OPEN', isDraft: false, parentNumber: 9003 }],
    };
    expect(graphiteStackPlace(forked, 9003)).toEqual({ position: 2, size: 3 });
    expect(graphiteStackPlace(forked, 9005)).toEqual({ position: 3, size: 3 });
  });

  it('gives none where the comment does not name the PR', () => {
    expect(graphiteStackPlace({ entries, forks: [] }, 31)).toBeNull();
    expect(graphiteStackPlace({ entries: [], forks: [] }, 31)).toBeNull();
  });

  it('gives none where the comment lists the PR alone', () => {
    expect(graphiteStackPlace({ entries: [{ number: 31, title: 'Alone', url: 'https://github.com/o/r/pull/31', state: 'OPEN', isDraft: false, parentNumber: null }], forks: [] }, 31)).toBeNull();
  });
});

it('leaves an unstacked PR on its own', async () => {
  const current = summary(5, 'feature');
  expect(await resolveStack({ current, page: emptyPage(), nativeStack: null }, noLookups)).toEqual({ entries: [{ ...current, parentNumber: null }], forks: [], currentIndex: 0, trunk: 'main', source: 'none' });
});

/**
 * Graphite's comment on offstreetparking/core#9029 (read 2026-10-31) in the shape GitHub renders it on the page: the line
 * #8994 → #9002 → #9001 → #9004 → #9026 → #9029 top first, each number a reference with its title and state icon, and
 * #8994's item naming #9003, which branches off it beside #9002, in a plain link. The titles stand in for the real ones.
 */
const forked9029 = new DOMParser().parseFromString(
  `<html><body><div class="timeline-comment-group" id="issuecomment-2"><div class="comment-body">
    <ul dir="auto">
      <li><strong><span class="reference"><svg class="octicon octicon-git-pull-request open"></svg><a class="issue-link js-issue-link" href="https://github.com/o/r/pull/9029">Layer 6<span class="issue-shorthand">&nbsp;#9029</span></a></span></strong> <a href="https://app.graphite.com/github/pr/o/r/9029?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a> 👈 <a href="https://app.graphite.com/github/pr/o/r/9029?utm_source=stack-comment-view-in-graphite" rel="nofollow">(View in Graphite)</a></li>
      <li><strong><span class="reference"><svg class="octicon octicon-git-pull-request open"></svg><a class="issue-link js-issue-link" href="https://github.com/o/r/pull/9026">Layer 5<span class="issue-shorthand">&nbsp;#9026</span></a></span></strong> <a href="https://app.graphite.com/github/pr/o/r/9026?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a></li>
      <li><strong><span class="reference"><svg class="octicon octicon-git-pull-request open"></svg><a class="issue-link js-issue-link" href="https://github.com/o/r/pull/9004">Layer 4<span class="issue-shorthand">&nbsp;#9004</span></a></span></strong> <a href="https://app.graphite.com/github/pr/o/r/9004?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a></li>
      <li><strong><span class="reference"><svg class="octicon octicon-git-pull-request open"></svg><a class="issue-link js-issue-link" href="https://github.com/o/r/pull/9001">Layer 3<span class="issue-shorthand">&nbsp;#9001</span></a></span></strong> <a href="https://app.graphite.com/github/pr/o/r/9001?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a></li>
      <li><strong><span class="reference"><svg class="octicon octicon-git-pull-request open"></svg><a class="issue-link js-issue-link" href="https://github.com/o/r/pull/9002">Layer 2<span class="issue-shorthand">&nbsp;#9002</span></a></span></strong> <a href="https://app.graphite.com/github/pr/o/r/9002?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a></li>
      <li><strong><span class="reference"><svg class="octicon octicon-git-pull-request open"></svg><a class="issue-link js-issue-link" href="https://github.com/o/r/pull/8994">Layer 1<span class="issue-shorthand">&nbsp;#8994</span></a></span></strong> <a href="https://app.graphite.com/github/pr/o/r/8994?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a>: 1 other dependent PR (<a href="https://github.com/o/r/pull/9003" data-hovercard-type="pull_request">#9003</a> <a href="https://app.graphite.com/github/pr/o/r/9003?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a>)</li>
      <li><code class="notranslate">main</code></li>
    </ul>
    <h2 dir="auto"></h2>
    <p dir="auto">This stack of pull requests is managed by <a href="https://graphite.dev?utm-source=stack-comment" rel="nofollow"><b>Graphite</b></a>. Learn more about <a href="https://stacking.dev/?utm_source=stack-comment" rel="nofollow">stacking</a>.</p>
  </div></div></body></html>`,
  'text/html',
);

/**
 * Graphite's comment on offstreetparking/core#9604 (read 2026-10-31) as GitHub's API renders it, each number a reference
 * without a title: its warning that a downstack PR is open, then the line #9528 → #9530 → #9577 → #9578 → #9604 top first,
 * #9530's item naming #9291, which branches off it.
 */
const forked9604 = new DOMParser().parseFromString(
  `<html><body><div class="timeline-comment-group" id="issuecomment-3"><div class="comment-body">
    <div class="markdown-alert markdown-alert-warning" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon octicon-alert mr-2"></svg>Warning</p><p dir="auto"><b>This pull request is not mergeable via GitHub because a downstack PR is open. Once all requirements are satisfied, merge this PR as a stack <a href="https://app.graphite.com/github/pr/o/r/9604?utm_source=stack-comment-downstack-mergeability-warning" rel="nofollow">on Graphite</a>.</b><br>
    <a href="https://graphite.dev/docs/merge-pull-requests" rel="nofollow">Learn more</a></p></div>
    <ul dir="auto">
      <li><strong><a class="issue-link js-issue-link" data-hovercard-type="pull_request" href="https://github.com/o/r/pull/9604">#9604</a></strong> <a href="https://app.graphite.com/github/pr/o/r/9604?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a> 👈 <a href="https://app.graphite.com/github/pr/o/r/9604?utm_source=stack-comment-view-in-graphite" rel="nofollow">(View in Graphite)</a></li>
      <li><strong><a class="issue-link js-issue-link" data-hovercard-type="pull_request" href="https://github.com/o/r/pull/9578">#9578</a></strong> <a href="https://app.graphite.com/github/pr/o/r/9578?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a></li>
      <li><strong><a class="issue-link js-issue-link" data-hovercard-type="pull_request" href="https://github.com/o/r/pull/9577">#9577</a></strong> <a href="https://app.graphite.com/github/pr/o/r/9577?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a></li>
      <li><strong><a class="issue-link js-issue-link" data-hovercard-type="pull_request" href="https://github.com/o/r/pull/9530">#9530</a></strong> <a href="https://app.graphite.com/github/pr/o/r/9530?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a>: 1 other dependent PR (<a href="https://github.com/o/r/pull/9291" data-hovercard-type="pull_request">#9291</a> <a href="https://app.graphite.com/github/pr/o/r/9291?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a>)</li>
      <li><strong><a class="issue-link js-issue-link" data-hovercard-type="pull_request" href="https://github.com/o/r/pull/9528">#9528</a></strong> <a href="https://app.graphite.com/github/pr/o/r/9528?utm_source=stack-comment-icon" rel="nofollow"><img alt="Graphite"></a></li>
      <li><code class="notranslate">main</code></li>
    </ul>
    <h2 dir="auto"></h2>
    <p dir="auto">This stack of pull requests is managed by <a href="https://graphite.dev?utm-source=stack-comment" rel="nofollow"><b>Graphite</b></a>. Learn more about <a href="https://stacking.dev/?utm_source=stack-comment" rel="nofollow">stacking</a>.</p>
  </div></div></body></html>`,
  'text/html',
);

/** page_data/stack_mergeability as GitHub answered it for both PRs of a two-PR native stack (verified signed in, 2026-10-15). */
const verifiedVerdict = { state: 'MERGEABLE', effectiveEntryStatus: 'READY', isInAutoMergeRange: false, channels: {}, statusCheckChannels: {} };

/**
 * Graphite's comment the way GitHub's API renders it on a lower PR of a stack (core#10166's, read 2026-11-12), each number
 * a reference without a title, top first: an item for each PR on the viewed PR's line, the PRs off it named in its item
 * as plain links (`: 2 dependent PRs (#10168, #10181)`), the viewed one marked 👈, and the trunk last.
 */
function graphiteComment(topFirst: Array<{ number: number; dependents?: number[]; viewed?: boolean }>): Document {
  const items = topFirst.map(({ number, dependents = [], viewed }) => {
    const named = dependents.map((dependent) => `<a href="https://github.com/o/r/pull/${dependent}" data-hovercard-type="pull_request">#${dependent}</a>`).join(', ');
    return `<li><strong><a class="issue-link js-issue-link" data-hovercard-type="pull_request" href="https://github.com/o/r/pull/${number}">#${number}</a></strong>${named && `: ${dependents.length} dependent PRs (${named})`}${viewed ? ' 👈' : ''}</li>`;
  });
  return new DOMParser().parseFromString(
    `<html><body><div class="timeline-comment-group" id="issuecomment-5"><div class="comment-body">
      <ul dir="auto">${items.join('')}<li><code class="notranslate">main</code></li></ul>
      <p dir="auto">This stack of pull requests is managed by <a href="https://graphite.dev?utm-source=stack-comment" rel="nofollow"><b>Graphite</b></a>.</p>
    </div></div></body></html>`,
    'text/html',
  );
}

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
