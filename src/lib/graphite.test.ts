import { describe, expect, it } from 'vitest';
import { importGraphiteSections, inboxSnapshotOf, type GraphiteInboxSnapshot } from './graphite';

// Graphite's "Share section" link for: status OPEN; NOT (author dependabot OR DJCrossman); review REVIEW_REQUIRED_GITHUB.
const EXAMPLE_LINK =
  'https://app.graphite.com/?new-section=JTdCJTIyZ3JvdXBzJTIyJTNBJTVCJTdCJTIycnVsZXMlMjIlM0ElNUIlN0IlMjJpc05lZ2F0ZWQlMjIlM0FmYWxzZSUyQyUyMmNvbmRpdGlvbnMlMjIlM0ElNUIlN0IlMjJraW5kJTIyJTNBJTIyQ09OU09MSURBVEVEX1BSX1NUQVRVU19JUyUyMiUyQyUyMnN0YXR1cyUyMiUzQSUyMk9QRU4lMjIlN0QlNUQlN0QlMkMlN0IlMjJpc05lZ2F0ZWQlMjIlM0F0cnVlJTJDJTIyY29uZGl0aW9ucyUyMiUzQSU1QiU3QiUyMmtpbmQlMjIlM0ElMjJBVVRIT1JfSVMlMjIlMkMlMjJ1c2VybmFtZSUyMiUzQSUyMmRlcGVuZGFib3QlMjIlN0QlMkMlN0IlMjJraW5kJTIyJTNBJTIyQVVUSE9SX0lTJTIyJTJDJTIydXNlcm5hbWUlMjIlM0ElMjJESkNyb3NzbWFuJTIyJTdEJTVEJTdEJTJDJTdCJTIyaXNOZWdhdGVkJTIyJTNBZmFsc2UlMkMlMjJjb25kaXRpb25zJTIyJTNBJTVCJTdCJTIya2luZCUyMiUzQSUyMlJFVklFV19TVEFUVVNfSVMlMjIlMkMlMjJzdGF0ZSUyMiUzQSUyMlJFVklFV19SRVFVSVJFRF9HSVRIVUIlMjIlN0QlNUQlN0QlNUQlN0QlNUQlN0Q%3D';
const EXAMPLE_QUERY = 'is:pr is:open draft:false -author:dependabot -author:DJCrossman review:required sort:updated-desc';
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
    const { views, notes } = importGraphiteSections(EXAMPLE_LINK);
    expect(views).toEqual([{ id: expect.any(String), name: 'Imported section', query: EXAMPLE_QUERY }]);
    expect(notes).toEqual([]);
  });

  it('turns a shared-sections link into named views scoped to their repositories', () => {
    // As Graphite writes it: standard base64, form-encoded into the query string.
    const link = `https://app.graphite.com/?shared-sections=${encodeURIComponent(btoa(encodeURIComponent(JSON.stringify([NEEDS_REVIEW, MERGED]))))}`;
    expect(importGraphiteSections(link).views).toEqual([
      { id: expect.any(String), name: 'Needs my review', query: 'is:pr repo:acme/web repo:acme/api review-requested:@me sort:updated-desc' },
      { id: expect.any(String), name: 'Merged', query: 'is:pr is:merged sort:updated-desc' },
    ]);
  });

  it('reads a link whose base64 plus signs were not form-encoded', () => {
    const filter = { groups: [{ rules: [{ isNegated: false, conditions: [{ kind: 'HAS_LABEL', label: '~' }] }] }] };
    const encoded = btoa(encodeURIComponent(JSON.stringify(filter)));
    expect(encoded).toContain('+');
    expect(importGraphiteSections(`https://app.graphite.com/?new-section=${encoded}`).views[0]?.query).toBe('is:pr label:"~" sort:updated-desc');
  });

  it('reads the raw JSON of either form', () => {
    expect(importGraphiteSections(JSON.stringify(NEEDS_REVIEW.filter, null, 2)).views.map((view) => view.name)).toEqual(['Imported section']);
    expect(importGraphiteSections(JSON.stringify([NEEDS_REVIEW, MERGED])).views.map((view) => view.name)).toEqual(['Needs my review', 'Merged']);
  });

  it('reads several links on separate lines', () => {
    const merged = `https://app.graphite.com/?shared-sections=${encodeURIComponent(btoa(encodeURIComponent(JSON.stringify([MERGED]))))}`;
    expect(importGraphiteSections(`${EXAMPLE_LINK}\n\n  ${merged}\n`).views.map((view) => view.query)).toEqual([EXAMPLE_QUERY, 'is:pr is:merged sort:updated-desc']);
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
    const { views, notes } = importGraphiteSections(JSON.stringify(filter));
    expect(views[0]?.query).toBe(
      'is:pr is:open author:alice author:bob label:"bug","needs review" -label:"wip" review:approved updated:>={{3d}} base:main in:title NOT "revert" sort:updated-desc',
    );
    expect(notes).toEqual([]);
  });

  it.each([
    ['OPEN', false, 'is:open draft:false'],
    ['DRAFT', false, 'is:open draft:true'],
    ['MERGED', false, 'is:merged'],
    ['CLOSED', false, 'is:closed is:unmerged'],
    ['MERGING', false, 'is:open'],
    ['DRAFT', true, 'draft:false'],
    ['MERGED', true, '-is:merged'],
    ['CLOSED', true, 'is:open'],
  ])('searches PR status %s (negated: %s) as %s', (status, isNegated, terms) => {
    const filter = { groups: [{ rules: [{ isNegated, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status }] }] }] };
    expect(importGraphiteSections(JSON.stringify(filter)).views[0]?.query).toBe(`is:pr ${terms} sort:updated-desc`);
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
    expect(importGraphiteSections(JSON.stringify(filter)).views[0]?.query).toBe(
      'is:pr -author:@me user-review-requested:@me team-review-requested:acme/web team:acme/platform sort:updated-desc',
    );
  });

  it('makes one view per group, since GitHub cannot OR them', () => {
    const section = {
      name: 'Mine',
      filter: {
        groups: [
          { rules: [{ isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: '<REPLACE_USERNAME>' }] }] },
          { rules: [{ isNegated: false, conditions: [{ kind: 'INCLUDES_ASSIGNEE', username: '<REPLACE_USERNAME>' }] }] },
        ],
      },
      repos: [],
    };
    const { views, notes } = importGraphiteSections(JSON.stringify([section]));
    expect(views.map(({ name, query }) => [name, query])).toEqual([
      ['Mine (1)', 'is:pr author:@me sort:updated-desc'],
      ['Mine (2)', 'is:pr assignee:@me sort:updated-desc'],
    ]);
    expect(notes).toEqual([expect.stringContaining('Mine:')]);
  });

  it('notes, per section, what GitHub search approximates or cannot express', () => {
    const section = {
      name: 'Hard',
      filter: {
        groups: [
          {
            rules: [
              { isNegated: false, conditions: [{ kind: 'NUM_FILES_CHANGED', numFiles: 10 }] },
              { isNegated: false, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'HAS_ACTIVE_REVIEW' }] },
              { isNegated: true, conditions: [{ kind: 'AUTHOR_IS', username: 'A bot' }] },
              { isNegated: false, conditions: [{ kind: 'APPROVED_BY', username: 'alice' }] },
              { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
              { isNegated: false, conditions: [{ kind: 'IS_EXTERNAL_REPOSITORY' }] },
            ],
          },
        ],
      },
      repos: [],
    };
    const { views, notes } = importGraphiteSections(JSON.stringify([section]));
    expect(views[0]?.query).toBe('is:pr -author:app/dependabot -author:app/github-actions reviewed-by:alice sort:updated-desc');
    expect(notes).toHaveLength(6);
    expect(notes.every((note) => note.startsWith('Hard: '))).toBe(true);
    expect(notes.join('\n')).toMatch(/Number of files changed.*left out/);
    expect(notes.join('\n')).toMatch(/HAS_ACTIVE_REVIEW.*left out/);
    expect(notes.join('\n')).toMatch(/A bot/);
    expect(notes.join('\n')).toMatch(/reviewed-by/);
    expect(notes.join('\n')).toMatch(/PR status is not OPEN.*left out/);
    expect(notes.join('\n')).toMatch(/PR origin.*left out/);
  });

  it('leaves out a positive "A bot" author rule rather than narrowing it', () => {
    const filter = { groups: [{ rules: [{ isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: 'A bot' }, { kind: 'AUTHOR_IS', username: 'alice' }] }] }] };
    const { views, notes } = importGraphiteSections(JSON.stringify(filter));
    expect(views[0]?.query).toBe('is:pr sort:updated-desc');
    expect(notes).toEqual([expect.stringContaining('left out')]);
  });

  it("reads the filter tree Graphite's inbox page holds as the share link's filter", () => {
    expect(importGraphiteSections(JSON.stringify(EXAMPLE_TREE)).views.map((view) => view.query)).toEqual([EXAMPLE_QUERY]);
  });

  it("turns the sections copied from Graphite's inbox into named views, scoped to the inbox's repositories where they use them", () => {
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
    const { views, notes } = importGraphiteSections(snapshot);
    expect(views.map(({ name, query }) => [name, query])).toEqual([
      ["Needs anyone's review", 'is:pr repo:acme/web repo:acme/api is:open draft:false -author:dependabot -author:DJCrossman review:required sort:updated-desc'],
      ['Merged', 'is:pr repo:acme/web is:merged sort:updated-desc'],
    ]);
    expect(notes).toEqual([]);
  });

  it("searches every repository, with a note, when the inbox's repositories are too many to list", () => {
    const defaultRepos = Array.from({ length: 9 }, (_, index) => ({ owner: 'acme', name: `repo-${index}` }));
    const { views, notes } = importGraphiteSections({
      sections: [{ name: 'Everything open', filter: { kind: 'OR', exprs: [{ kind: 'AND', exprs: [{ kind: 'OR', exprs: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] }] }] }, repos: [], usesDefaultRepos: true, includeInTotalCount: true }],
      defaultRepos,
    });
    expect(views[0]?.query).toBe('is:pr is:open draft:false sort:updated-desc');
    expect(notes).toEqual([expect.stringMatching(/^Everything open: .*9 repositories/)]);
  });

  it('leaves out, with a note, a copied section whose filter it cannot read', () => {
    const { views, notes } = importGraphiteSections({
      sections: [
        { name: 'Odd', filter: null, repos: [], usesDefaultRepos: false, includeInTotalCount: false },
        { name: 'Mine', filter: EXAMPLE_TREE, repos: [], usesDefaultRepos: false, includeInTotalCount: true },
      ],
      defaultRepos: [],
    });
    expect(views.map((view) => view.name)).toEqual(['Mine']);
    expect(notes).toEqual([expect.stringMatching(/^Odd: .*left out/)]);
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

describe('inboxSnapshotOf', () => {
  it("copies the sections and repositories out of the React state some levels above an element of Graphite's inbox", () => {
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
    const inbox = {
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
      return: { memoizedProps: { children: [] }, return: null },
    };
    let fiber: object = inbox;
    for (let level = 0; level < 40; level += 1) fiber = { memoizedProps: level % 2 ? { className: 'row' } : null, return: fiber };
    const item = document.createElement('li');
    Object.assign(item, { '__reactFiber$k3j9x2': fiber });

    expect(inboxSnapshotOf(item)).toEqual({
      sections: [{ name: "Needs anyone's review", filter: EXAMPLE_TREE, repos: [], usesDefaultRepos: true, includeInTotalCount: true }],
      defaultRepos: [{ owner: 'acme', name: 'web' }],
    });
  });

  it('finds nothing behind an element React did not render', () => {
    expect(inboxSnapshotOf(document.createElement('li'))).toBeNull();
  });
});
