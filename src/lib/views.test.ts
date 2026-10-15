import { assert, describe, expect, it } from 'vitest';
import { graphiteInboxSnapshot, importGraphiteSections, searchForFilter } from './graphite';
import userInbox from './graphite-inbox.fixture.json';
import { DEFAULT_VIEWS, decodeViewsShareHash, encodeViewsShareLink, inboxFilterOf, organizationScope, resolveViewQuery, sectionCount } from './views';

describe('the default views', () => {
  const imported = importGraphiteSections(graphiteInboxSnapshot.parse(userInbox)).views.map(({ view }) => view);

  it("are Graphite's sections in its order, without the user's own", () => {
    expect(DEFAULT_VIEWS.map((view) => view.name)).toEqual([
      'Needs your review',
      'Returned to you',
      'Approved',
      'Waiting for reviewers',
      'Drafts',
      "Needs anyone's review",
      'Merging and recently merged',
      'Waiting for author',
    ]);
    expect(new Set(DEFAULT_VIEWS.map((view) => view.id)).size).toBe(DEFAULT_VIEWS.length);
  });

  it.each(DEFAULT_VIEWS.map((view) => [view.name, view] as const))('%s carries the filter the Graphite import makes and the query it compiles to', (name, view) => {
    expect(view.filter).toEqual(imported.find((candidate) => candidate.name === name)?.filter);
    assert.isDefined(view.filter);
    expect(view.query).toBe(searchForFilter(view.filter, []).query);
    expect(view.repos).toBeUndefined();
  });
});

describe('share links', () => {
  it('round-trips the default views through a share link', () => {
    const link = encodeViewsShareLink(DEFAULT_VIEWS);
    expect(link.startsWith('https://github.com/#views=')).toBe(true);
    const hash = new URL(link).hash;
    const decoded = decodeViewsShareHash(hash);
    expect(decoded?.map((v) => v.query)).toEqual(DEFAULT_VIEWS.map((v) => v.query));
  });

  it("carries a view's Graphite filter and repositories", () => {
    const views = [
      {
        id: 'mine',
        name: 'Mine',
        query: 'is:pr repo:acme/web author:@me sort:updated-desc',
        filter: { groups: [{ rules: [{ isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] }] }] },
        repos: [{ owner: 'acme', name: 'web' }],
      },
    ];
    expect(decodeViewsShareHash(new URL(encodeViewsShareLink(views)).hash)).toEqual(views);
    // The same link written by hand, then with a filter of another shape.
    const [mine] = views;
    expect(decodeViewsShareHash(`#views=${btoa(JSON.stringify([mine]))}`)).toEqual(views);
    expect(decodeViewsShareHash(`#views=${btoa(JSON.stringify([{ ...mine, filter: { groups: 'all' } }]))}`)).toBeNull();
  });

  it('rejects hashes without views or with malformed payloads', () => {
    expect(decodeViewsShareHash('')).toBeNull();
    expect(decodeViewsShareHash('#other=1')).toBeNull();
    expect(decodeViewsShareHash('#views=not-base64!')).toBeNull();
    expect(decodeViewsShareHash('#views=' + btoa('[{"id":1}]'))).toBeNull();
  });

  it('rejects a link with any view of another shape, a filter rule mixing condition kinds included', () => {
    const mine = { id: 'mine', name: 'Mine', query: 'is:pr author:@me' };
    const mixed = { groups: [{ rules: [{ isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: 'a' }, { kind: 'MENTIONS', username: 'a' }] }] }] };
    expect(decodeViewsShareHash(new URL(encodeViewsShareLink([mine, { ...mine, id: 'theirs', filter: mixed }])).hash)).toBeNull();
  });

  it('survives unicode view names', () => {
    const views = [{ id: 'x', name: 'Révisions à faire ✓', query: 'is:pr' }];
    expect(decodeViewsShareHash(new URL(encodeViewsShareLink(views)).hash)).toEqual(views);
  });
});

describe('resolveViewQuery', () => {
  it('resolves relative times to the moment, not the day, and prepends the scope', () => {
    const view = { id: 'm', name: 'Merged', query: 'is:merged merged:>={{7d}}' };
    expect(resolveViewQuery(view, 'org:acme', new Date('2026-10-09T14:40:00Z'))).toBe('org:acme is:merged merged:>=2026-10-02T14:40:00Z');
  });

  it('ORs repeated repo: terms in the scope and the query, which GitHub would AND', () => {
    const view = { id: 'r', name: 'Repos', query: 'is:pr repo:acme/web repo:acme/api author:@me' };
    expect(resolveViewQuery({ ...view, query: 'is:pr author:@me' }, 'repo:acme/web repo:acme/api repo:acme/ios')).toBe(
      '(repo:acme/web OR repo:acme/api OR repo:acme/ios) is:pr author:@me',
    );
    expect(resolveViewQuery(view, '')).toBe('is:pr (repo:acme/web OR repo:acme/api) author:@me');
  });

  it('leaves the repositories of a group as they are, however many the picker chose', () => {
    const repos = ['web', 'api', 'ios', 'android'].map((name) => ({ owner: 'acme', name }));
    const group = '(repo:acme/web OR repo:acme/api OR repo:acme/ios OR repo:acme/android)';
    const view = { id: 'r', name: 'Repos', query: 'is:pr author:@me' };
    expect(resolveViewQuery(view, organizationScope({ login: 'acme', isViewer: false }, repos))).toBe(`${group} is:pr author:@me`);
    // A section's own repositories, as the section editor compiles them.
    expect(resolveViewQuery({ ...view, query: `is:pr ${group} author:@me` }, 'org:acme')).toBe(`is:pr ${group} author:@me`);
  });

  it('searches the repositories a query names instead of the inbox scope, as a Graphite section with its own does', () => {
    const view = { id: 'r', name: 'Repos', query: 'is:pr (repo:acme/web OR repo:acme/api) author:@me' };
    expect(resolveViewQuery(view, 'org:acme')).toBe(view.query);
    expect(resolveViewQuery({ ...view, query: 'is:pr -repo:acme/web' }, 'org:acme')).toBe('org:acme is:pr -repo:acme/web');
  });

  it('leaves plain queries alone when there is no scope', () => {
    expect(resolveViewQuery({ id: 'a', name: 'A', query: ' is:pr author:@me ' }, '')).toBe('is:pr author:@me');
  });

  it("recognises GitHub's own inbox sections and never scopes them", () => {
    const view = { id: 'n', name: 'Needs review', query: 'inbox:review-requested' };
    expect(inboxFilterOf(view)).toBe('review-requested');
    expect(inboxFilterOf({ id: 'x', name: 'X', query: 'inbox:bogus' })).toBeNull();
    expect(inboxFilterOf({ id: 'y', name: 'Y', query: 'is:pr inbox:review-requested' })).toBeNull();
    expect(resolveViewQuery(view, 'org:acme')).toBe('inbox:review-requested');
  });
});

describe('organizationScope', () => {
  it("searches the organization's repositories, or the viewer's own, unless repositories are chosen", () => {
    expect(organizationScope({ login: 'acme', isViewer: false }, [])).toBe('org:acme');
    expect(organizationScope({ login: 'octocat', isViewer: true }, [])).toBe('user:octocat');
    expect(organizationScope({ login: 'acme', isViewer: false }, [{ owner: 'acme', name: 'web' }])).toBe('repo:acme/web');
    expect(organizationScope({ login: 'acme', isViewer: false }, [{ owner: 'acme', name: 'web' }, { owner: 'acme', name: 'api' }])).toBe('(repo:acme/web OR repo:acme/api)');
  });
});

describe('sectionCount', () => {
  it.each([
    [0, undefined, '0'],
    [99, undefined, '99'],
    [100, undefined, '99+'],
    [141, undefined, '99+'],
    [40, 15, '15+'],
    [15, 15, '15'],
    [150, 100, '99+'],
  ])('shows %i pull requests in a view limited to %s as %s', (totalCount, limit, shown) => {
    expect(sectionCount({ view: { id: 'v', name: 'V', query: 'is:pr', limit }, totalCount })).toBe(shown);
  });
});
