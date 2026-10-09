import { describe, expect, it } from 'vitest';
import { importGraphiteSections, inboxSnapshotOf, type GraphiteInboxSnapshot } from './graphite';
// The user's nine Graphite sections as their inbox page holds them (2026-10-09); the repositories are placeholders.
import userInbox from './graphite-inbox.fixture.json';

// Graphite's "Share section" link for: status OPEN; NOT (author dependabot OR DJCrossman); review REVIEW_REQUIRED_GITHUB.
const EXAMPLE_LINK =
  'https://app.graphite.com/?new-section=JTdCJTIyZ3JvdXBzJTIyJTNBJTVCJTdCJTIycnVsZXMlMjIlM0ElNUIlN0IlMjJpc05lZ2F0ZWQlMjIlM0FmYWxzZSUyQyUyMmNvbmRpdGlvbnMlMjIlM0ElNUIlN0IlMjJraW5kJTIyJTNBJTIyQ09OU09MSURBVEVEX1BSX1NUQVRVU19JUyUyMiUyQyUyMnN0YXR1cyUyMiUzQSUyMk9QRU4lMjIlN0QlNUQlN0QlMkMlN0IlMjJpc05lZ2F0ZWQlMjIlM0F0cnVlJTJDJTIyY29uZGl0aW9ucyUyMiUzQSU1QiU3QiUyMmtpbmQlMjIlM0ElMjJBVVRIT1JfSVMlMjIlMkMlMjJ1c2VybmFtZSUyMiUzQSUyMmRlcGVuZGFib3QlMjIlN0QlMkMlN0IlMjJraW5kJTIyJTNBJTIyQVVUSE9SX0lTJTIyJTJDJTIydXNlcm5hbWUlMjIlM0ElMjJESkNyb3NzbWFuJTIyJTdEJTVEJTdEJTJDJTdCJTIyaXNOZWdhdGVkJTIyJTNBZmFsc2UlMkMlMjJjb25kaXRpb25zJTIyJTNBJTVCJTdCJTIya2luZCUyMiUzQSUyMlJFVklFV19TVEFUVVNfSVMlMjIlMkMlMjJzdGF0ZSUyMiUzQSUyMlJFVklFV19SRVFVSVJFRF9HSVRIVUIlMjIlN0QlNUQlN0QlNUQlN0QlNUQlN0Q%3D';
const EXAMPLE_QUERY = 'is:pr is:open -author:dependabot -author:app/dependabot -author:DJCrossman review:none draft:false sort:updated-desc';
// The same filter as Graphite's signed-in inbox page holds it (section "Needs anyone's review").
const EXAMPLE_TREE = {
  kind: 'OR',
  exprs: [
    {
      kind: 'AND',
      exprs: [
        { kind: 'OR', exprs: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
        { kind: 'NOT', expr: { kind: 'OR', exprs: [{ kind: 'AUTHOR_IS', username: 'dependabot' }, { kind: 'AUTHOR_IS', username: 'DJCrossman' }] } },
        { kind: 'OR', exprs: [{ kind: 'REVIEW_STATUS_IS', state: 'REVIEW_REQUIRED_GITHUB' }] },
      ],
    },
  ],
};

const NEEDS_REVIEW = {
  name: 'Needs my review',
  filter: { groups: [{ rules: [{ isNegated: false, conditions: [{ kind: 'OPEN_REVIEW_REQUEST_FOR', username: '<REPLACE_USERNAME>' }] }] }] },
  repos: [
    { owner: 'acme', name: 'web' },
    { owner: 'acme', name: 'api', forge: 'GITHUB' },
  ],
  includeInTotalCount: true,
};
const MERGED = {
  name: 'Merged',
  filter: { groups: [{ rules: [{ isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGED' }] }] }] },
  repos: [],
  includeInTotalCount: false,
};

describe('importGraphiteSections', () => {
  it('turns a new-section link into one unnamed view', () => {
    expect(importGraphiteSections(EXAMPLE_LINK)).toEqual({
      views: [{ view: { id: expect.any(String), name: 'Imported section', query: EXAMPLE_QUERY, filter: expect.any(Object) }, notes: [] }],
      notes: [],
      sectionCount: 1,
      inboxRepos: null,
    });
  });

  it('turns a shared-sections link into named views scoped to their repositories', () => {
    // As Graphite writes it: standard base64, form-encoded into the query string.
    const link = `https://app.graphite.com/?shared-sections=${encodeURIComponent(btoa(encodeURIComponent(JSON.stringify([NEEDS_REVIEW, MERGED]))))}`;
    expect(importGraphiteSections(link).views.map(({ view }) => [view.name, view.query])).toEqual([
      ['Needs my review', 'is:pr (repo:acme/web OR repo:acme/api) review-requested:@me sort:updated-desc'],
      ['Merged', 'is:pr is:merged sort:updated-desc'],
    ]);
  });

  it('keeps each view\'s filter, with the viewer as @me, and its own repositories, for the section editor', () => {
    const link = `https://app.graphite.com/?shared-sections=${encodeURIComponent(btoa(encodeURIComponent(JSON.stringify([NEEDS_REVIEW]))))}`;
    const [imported] = importGraphiteSections(link).views;
    expect(imported?.view.filter).toEqual({ groups: [{ rules: [{ isNegated: false, conditions: [{ kind: 'OPEN_REVIEW_REQUEST_FOR', username: '@me' }] }] }] });
    expect(imported?.view.repos).toEqual([
      { owner: 'acme', name: 'web' },
      { owner: 'acme', name: 'api' },
    ]);
  });

  it('reads a link whose base64 plus signs were not form-encoded', () => {
    const filter = { groups: [{ rules: [{ isNegated: false, conditions: [{ kind: 'HAS_LABEL', label: '~' }] }] }] };
    const encoded = btoa(encodeURIComponent(JSON.stringify(filter)));
    expect(encoded).toContain('+');
    expect(importGraphiteSections(`https://app.graphite.com/?new-section=${encoded}`).views[0]?.view.query).toBe('is:pr label:"~" sort:updated-desc');
  });

  it('reads the raw JSON of either form', () => {
    expect(importGraphiteSections(JSON.stringify(NEEDS_REVIEW.filter, null, 2)).views.map(({ view }) => view.name)).toEqual(['Imported section']);
    expect(importGraphiteSections(JSON.stringify([NEEDS_REVIEW, MERGED])).views.map(({ view }) => view.name)).toEqual(['Needs my review', 'Merged']);
  });

  it("reads the filter tree Graphite's inbox page holds as the share link's filter", () => {
    expect(importGraphiteSections(JSON.stringify(EXAMPLE_TREE)).views.map(({ view }) => view.query)).toEqual([EXAMPLE_QUERY]);
  });

  it('reads several links on separate lines', () => {
    const merged = `https://app.graphite.com/?shared-sections=${encodeURIComponent(btoa(encodeURIComponent(JSON.stringify([MERGED]))))}`;
    expect(importGraphiteSections(`${EXAMPLE_LINK}\n\n  ${merged}\n`).views.map(({ view }) => view.query)).toEqual([EXAMPLE_QUERY, 'is:pr is:merged sort:updated-desc']);
  });

  it('ANDs rules, ORs conditions within a rule and negates whole rules', () => {
    const filter = {
      groups: [
        {
          rules: [
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }, { kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }] },
            { isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: 'alice' }, { kind: 'AUTHOR_IS', username: 'bob' }] },
            { isNegated: false, conditions: [{ kind: 'HAS_LABEL', label: 'bug' }, { kind: 'HAS_LABEL', label: 'needs review' }] },
            { isNegated: true, conditions: [{ kind: 'HAS_LABEL', label: 'wip' }] },
            { isNegated: false, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'ONE_OR_MORE_APPROVALS' }, { kind: 'REVIEW_STATUS_IS', state: 'IS_FULLY_APPROVED' }] },
            { isNegated: false, conditions: [{ kind: 'LAST_UPDATED', hours: 72 }] },
            { isNegated: false, conditions: [{ kind: 'MERGE_BASE_IS', mergeBase: 'main' }] },
            { isNegated: true, conditions: [{ kind: 'TITLE_CONTAINS', text: 'revert' }] },
          ],
        },
      ],
    };
    const [imported] = importGraphiteSections(JSON.stringify(filter)).views;
    expect(imported?.view.query).toBe(
      'is:pr is:open (author:alice OR author:bob) label:"bug","needs review" -label:"wip" review:approved updated:>={{3d}} base:main in:title NOT "revert" sort:updated-desc',
    );
    expect(imported?.notes).toEqual([]);
  });

  it.each([
    [['OPEN'], false, 'is:pr is:open sort:updated-desc'],
    [['DRAFT'], false, 'is:pr is:open draft:true sort:updated-desc'],
    [['MERGED'], false, 'is:pr is:merged sort:updated-desc'],
    [['CLOSED'], false, 'is:pr is:closed -is:merged sort:updated-desc'],
    [['OPEN', 'MERGING'], false, 'is:pr is:open sort:updated-desc'],
    [['DRAFT'], true, 'is:pr draft:false sort:updated-desc'],
    [['MERGED'], true, 'is:pr -is:merged sort:updated-desc'],
    [['CLOSED'], true, 'is:pr is:open sort:updated-desc'],
    [['MERGING'], true, 'is:pr sort:updated-desc'],
    [['OPEN'], true, 'is:pr is:closed sort:updated-desc'],
    [['DRAFT', 'MERGED'], true, 'is:pr draft:false -is:merged sort:updated-desc'],
    [['CLOSED', 'MERGED'], true, 'is:pr is:open sort:updated-desc'],
  ])('searches PR status %j (negated: %s) as %s', (statuses, isNegated, query) => {
    const filter = { groups: [{ rules: [{ isNegated, conditions: statuses.map((status) => ({ kind: 'CONSOLIDATED_PR_STATUS_IS', status })) }] }] };
    expect(importGraphiteSections(JSON.stringify(filter)).views[0]?.view.query).toBe(query);
  });

  it('searches the states all of a group\'s status rules allow, so "not Draft or Merging" and "Open" is open and ready', () => {
    // How Graphite's default "Returned to you" and "Approved" sections begin.
    const filter = {
      groups: [
        {
          rules: [
            { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }, { kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: false, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'HAS_CHANGES_REQUESTED' }] },
          ],
        },
      ],
    };
    const [imported] = importGraphiteSections(JSON.stringify(filter)).views;
    expect(imported?.view.query).toBe('is:pr is:open draft:false review:changes_requested sort:updated-desc');
    expect(imported?.notes).toEqual([]);
  });

  it('maps <REPLACE_USERNAME> to @me and team slugs to team qualifiers', () => {
    const filter = {
      groups: [
        {
          rules: [
            { isNegated: true, conditions: [{ kind: 'AUTHOR_IS', username: '<REPLACE_USERNAME>' }] },
            { isNegated: false, conditions: [{ kind: 'INCLUDES_DIRECT_REVIEWER', username: '<REPLACE_USERNAME>' }] },
            { isNegated: false, conditions: [{ kind: 'INCLUDES_DIRECT_TEAM_REVIEWER', slug: 'acme/web' }] },
            { isNegated: false, conditions: [{ kind: 'MENTIONS', username: 'acme/platform' }] },
          ],
        },
      ],
    };
    expect(importGraphiteSections(JSON.stringify(filter)).views[0]?.view.query).toBe(
      'is:pr -author:@me user-review-requested:@me team-review-requested:acme/web team:acme/platform sort:updated-desc',
    );
  });

  it("searches Graphite's signed-in user as @me, from the inbox page's copy or as told", () => {
    const filter = {
      kind: 'OR',
      exprs: [
        {
          kind: 'AND',
          exprs: [
            { kind: 'NOT', expr: { kind: 'OR', exprs: [{ kind: 'AUTHOR_IS', username: 'dependabot' }, { kind: 'AUTHOR_IS', username: 'djcrossman' }] } },
            { kind: 'OR', exprs: [{ kind: 'OPEN_REVIEW_REQUEST_FOR', username: 'DJCrossman' }] },
          ],
        },
      ],
    };
    const copied = importGraphiteSections({
      sections: [{ name: 'Mine', filter, repos: [], usesDefaultRepos: true, includeInTotalCount: true }],
      defaultRepos: [],
      viewerLogin: 'DJCrossman',
    });
    expect(copied.views[0]?.view.query).toBe('is:pr -author:dependabot -author:app/dependabot -author:@me review-requested:@me sort:updated-desc');
    expect(importGraphiteSections(JSON.stringify(filter), { viewerLogin: 'DJCrossman' }).views[0]?.view.query).toBe(copied.views[0]?.view.query);
    expect(importGraphiteSections(JSON.stringify(filter)).views[0]?.view.query).toBe(
      'is:pr -author:dependabot -author:app/dependabot -author:djcrossman review-requested:DJCrossman sort:updated-desc',
    );
  });

  it('ORs the groups that remain, each in parentheses, with the terms they share in front', () => {
    const section = {
      name: 'Mine',
      filter: {
        groups: [
          {
            rules: [
              { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }] },
              { isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: '<REPLACE_USERNAME>' }] },
            ],
          },
          {
            rules: [
              { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
              { isNegated: false, conditions: [{ kind: 'OPEN_REVIEW_REQUEST_FOR', username: '<REPLACE_USERNAME>' }] },
              { isNegated: true, conditions: [{ kind: 'AUTHOR_IS', username: '<REPLACE_USERNAME>' }] },
            ],
          },
          {
            // Only narrows the first group.
            rules: [
              { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }] },
              { isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: '<REPLACE_USERNAME>' }] },
              { isNegated: false, conditions: [{ kind: 'HAS_LABEL', label: 'wip' }] },
            ],
          },
        ],
      },
      repos: [{ owner: 'acme', name: 'web' }],
    };
    expect(importGraphiteSections(JSON.stringify([section])).views.map(({ view }) => [view.name, view.query])).toEqual([
      ['Mine', 'is:pr repo:acme/web is:open ((draft:true author:@me) OR (review-requested:@me -author:@me)) sort:updated-desc'],
    ]);
  });

  it('makes one view per group when ORing them would take more than the five operators a search allows', () => {
    const labelled = (count: number) => ({
      groups: Array.from({ length: count }, (_, index) => ({ rules: [{ isNegated: false, conditions: [{ kind: 'HAS_LABEL', label: `l${index}` }] }] })),
    });
    expect(importGraphiteSections(JSON.stringify([{ name: 'Six', filter: labelled(6), repos: [] }])).views.map(({ view }) => view.query)).toEqual([
      'is:pr ((label:"l0") OR (label:"l1") OR (label:"l2") OR (label:"l3") OR (label:"l4") OR (label:"l5")) sort:updated-desc',
    ]);
    const { views } = importGraphiteSections(JSON.stringify([{ name: 'Seven', filter: labelled(7), repos: [] }]));
    expect(views.map(({ view }) => [view.name, view.query])).toEqual(Array.from({ length: 7 }, (_, index) => [`Seven (${index + 1})`, `is:pr label:"l${index}" sort:updated-desc`]));
    expect(views.every(({ notes }) => notes.some((note) => note.includes('any of its 7 filter groups')))).toBe(true);
  });

  it("turns the sections copied from Graphite's inbox into views, leaving the inbox's repositories to its scope", () => {
    const snapshot: GraphiteInboxSnapshot = {
      sections: [
        { name: "Needs anyone's review", filter: EXAMPLE_TREE, repos: [], usesDefaultRepos: true, includeInTotalCount: true },
        {
          name: 'Merged',
          filter: { kind: 'OR', exprs: [{ kind: 'AND', exprs: [{ kind: 'OR', exprs: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGED' }] }] }] },
          repos: [{ owner: 'acme', name: 'web' }],
          usesDefaultRepos: false,
          includeInTotalCount: false,
        },
      ],
      defaultRepos: [
        { owner: 'acme', name: 'web' },
        { owner: 'acme', name: 'api' },
      ],
    };
    const { views, sectionCount, inboxRepos } = importGraphiteSections(snapshot);
    expect(views.map(({ view }) => [view.name, view.query])).toEqual([
      ["Needs anyone's review", EXAMPLE_QUERY],
      ['Merged', 'is:pr repo:acme/web is:merged sort:updated-desc'],
    ]);
    expect([sectionCount, inboxRepos]).toEqual([2, snapshot.defaultRepos]);
  });

  it('leaves out, with a note, a copied section whose filter it cannot read', () => {
    const { views, notes, sectionCount } = importGraphiteSections({
      sections: [
        { name: 'Odd', filter: null, repos: [], usesDefaultRepos: false, includeInTotalCount: false },
        { name: 'Mine', filter: EXAMPLE_TREE, repos: [], usesDefaultRepos: false, includeInTotalCount: true },
      ],
      defaultRepos: [],
    });
    expect(views.map(({ view }) => view.name)).toEqual(['Mine']);
    expect([notes, sectionCount]).toEqual([[expect.stringMatching(/^Odd: .*left out/)], 2]);
  });

  it('leaves out a group that needs what GitHub cannot search for, but only the rule when it is negated', () => {
    const section = {
      name: 'Hard',
      filter: {
        groups: [
          { rules: [{ isNegated: false, conditions: [{ kind: 'NUM_FILES_CHANGED', numFiles: 10 }] }] },
          { rules: [{ isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: 'A bot' }, { kind: 'AUTHOR_IS', username: 'alice' }] }] },
          {
            rules: [
              { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGED' }] },
              { isNegated: true, conditions: [{ kind: 'IS_EXTERNAL_REPOSITORY' }] },
              { isNegated: true, conditions: [{ kind: 'AUTHOR_IS', username: 'A bot' }, { kind: 'AUTHOR_IS', username: 'acme/bots' }] },
            ],
          },
        ],
      },
      repos: [],
    };
    const [imported, ...others] = importGraphiteSections(JSON.stringify([section])).views;
    expect(others).toEqual([]);
    expect(imported?.view.query).toBe('is:pr is:merged -author:app/dependabot -author:app/github-actions sort:updated-desc');
    expect(imported?.notes).toEqual([
      expect.stringMatching(/^“Number of files changed” .*filter group was left out/),
      expect.stringMatching(/^“Author is A bot or alice” .*filter group was left out/),
      expect.stringMatching(/^“PR origin” .*rule was left out/),
      expect.stringMatching(/“A bot” is searched as/),
      expect.stringMatching(/acme\/bots has no GitHub search equivalent/),
    ]);

    const { views, notes } = importGraphiteSections(JSON.stringify([{ ...section, filter: { groups: section.filter.groups.slice(0, 2) } }]));
    expect(views).toEqual([]);
    expect(notes.at(-1)).toMatch(/^Hard: .*section was left out/);
  });

  it.each([
    ['nothing', ''],
    ['plain text', 'needs review'],
    ['a link without a section', 'https://app.graphite.com/'],
    ['a section that does not decode', 'https://app.graphite.com/?new-section=%%%not-base64'],
    ['a section cut short', EXAMPLE_LINK.slice(0, 120)],
    ['JSON that does not parse', '{"groups": ['],
    ['JSON of another shape', '{"groups": 3}'],
    ['an empty section list', '[]'],
    ['a rule without conditions', '{"groups":[{"rules":[{"isNegated":false,"conditions":[]}]}]}'],
    ['a condition missing its value', '{"groups":[{"rules":[{"isNegated":false,"conditions":[{"kind":"AUTHOR_IS"}]}]}]}'],
    ['a rule mixing kinds', '{"groups":[{"rules":[{"isNegated":false,"conditions":[{"kind":"AUTHOR_IS","username":"a"},{"kind":"MENTIONS","username":"a"}]}]}]}'],
  ])('rejects %s with a message', (_, input) => {
    expect(() => importGraphiteSections(input)).toThrow(/\S/);
  });
});

describe("the user's Graphite inbox", () => {
  const { views, notes, inboxRepos } = importGraphiteSections(userInbox as GraphiteInboxSnapshot);

  // Each verified against GitHub's dashboard search, signed in (docs/research/graphite-sections.md, "Verified mapping").
  it.each([
    ['Needs your review', 'is:pr -author:@me is:open draft:false review-requested:@me -review:changes_requested sort:updated-desc'],
    ['Returned to you', 'is:pr is:open draft:false author:@me review:changes_requested sort:updated-desc'],
    ['Approved', 'is:pr is:open draft:false author:@me review:approved -review:changes_requested sort:updated-desc'],
    ['Waiting for reviewers', 'is:pr is:open draft:false author:@me -review:approved -review:changes_requested sort:updated-desc'],
    ['Drafts', 'is:pr is:open draft:true author:@me sort:updated-desc'],
    ['Waiting for POMS reviewers', 'is:pr is:open draft:false (author:reid112 OR author:KBaldwin2 OR author:Patrick-Ullrich OR author:puttputt) -review:approved sort:updated-desc'],
    ["Needs anyone's review", 'is:pr is:open draft:false -author:dependabot -author:app/dependabot -author:@me review:none sort:updated-desc'],
    ['Merging and recently merged', 'is:pr is:merged merged:>={{7d}} sort:updated-desc'],
    ['Waiting for author', 'is:pr is:open draft:false reviewed-by:@me -review-requested:@me -author:@me sort:updated-desc'],
  ])('searches %s as %s', (name, query) => {
    // Term order does not matter to GitHub.
    expect(views.find(({ view }) => view.name === name)?.view.query.split(' ').sort()).toEqual(query.split(' ').sort());
  });

  it('makes one view per section, noting only the merge-queue group it leaves out, and offers the inbox repositories', () => {
    expect(views).toHaveLength(9);
    expect(notes).toEqual([]);
    expect(views.filter((imported) => imported.notes.length > 0).map(({ view, notes }) => [view.name, notes])).toEqual([
      ['Merging and recently merged', ['“PR status is MERGING” has no GitHub search equivalent; that filter group was left out.']],
    ]);
    expect(inboxRepos).toEqual(userInbox.defaultRepos);
  });
});

describe('inboxSnapshotOf', () => {
  it("copies the sections, repositories and signed-in user out of the React state above an element of Graphite's inbox", () => {
    const section = {
      clientId: 'section/42',
      sectionId: 42,
      name: "Needs anyone's review",
      repos: [],
      usesDefaultRepos: true,
      filter: EXAMPLE_TREE,
      includeInTotalCount: true,
      totalUnpaginatedPrs: 3,
      countsDegraded: false,
      sort: { method: 'updatedAt', direction: 'DESC' },
    };
    // Graphite's signed-in-user context near the root, the inbox's state some 40 levels above its sidebar.
    let fiber: object = { memoizedProps: { value: { user: { githubLogin: 'DJCrossman', github: { login: 'DJCrossman', id: 1 } } }, children: [] }, return: null };
    for (let level = 0; level < 60; level += 1) fiber = { memoizedProps: { children: [] }, return: fiber };
    fiber = {
      memoizedProps: {
        snapshot: {
          sections: [section],
          syncedRepos: [
            { owner: 'acme', name: 'web', isInvalid: false, id: 7 },
            { owner: 'acme', name: 'gone', isInvalid: true, id: 8 },
          ],
        },
        actions: { selectSection: () => {} },
      },
      return: fiber,
    };
    for (let level = 0; level < 40; level += 1) fiber = { memoizedProps: level % 2 ? { className: 'row' } : null, return: fiber };
    const item = document.createElement('li');
    Object.assign(item, { '__reactFiber$k3j9x2': fiber });

    expect(inboxSnapshotOf(item)).toEqual({
      sections: [{ name: "Needs anyone's review", filter: EXAMPLE_TREE, repos: [], usesDefaultRepos: true, includeInTotalCount: true }],
      defaultRepos: [{ owner: 'acme', name: 'web' }],
      viewerLogin: 'DJCrossman',
    });
  });

  it('finds nothing behind an element React did not render', () => {
    expect(inboxSnapshotOf(document.createElement('li'))).toBeNull();
  });
});
