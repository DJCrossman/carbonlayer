import { describe, expect, it } from 'vitest';
import { encodeViewsShareLink } from '../lib/views';
import { parseAppHash, parseGitHubLocation, routeInApp, toAppHash, toGitHubUrl, type AppRoute } from './routes';

describe('parseGitHubLocation', () => {
  it("takes over GitHub's homepage", () => {
    expect(parseGitHubLocation(new URL('https://github.com/'))).toEqual({ page: 'inbox', importViews: null });
    expect(parseGitHubLocation(new URL('https://github.com'))).toEqual({ page: 'inbox', importViews: null });
  });

  it.each(['/pulls', '/pulls/inbox', '/pulls/search?q=is%3Apr+is%3Aopen', '/pulls/authored', '/pulls/12345'])(
    "leaves GitHub's pull request dashboard at %s to GitHub",
    (path) => {
      expect(parseGitHubLocation(new URL(`https://github.com${path}`))).toEqual({ page: 'none' });
    },
  );

  it('recognises the PR pages', () => {
    expect(parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42'))).toEqual({
      page: 'pr',
      repo: { owner: 'acme', name: 'widgets' },
      number: 42,
      section: 'conversation',
    });
    expect(parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42/files'))).toMatchObject({ page: 'pr', section: 'files' });
    expect(parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42/changes'))).toMatchObject({ page: 'pr', section: 'files' });
  });

  it.each([
    ['/acme/widgets/pull/42#issue-4200', 'conversation', 'issue-4200'],
    ['/acme/widgets/pull/42#issuecomment-7', 'conversation', 'issuecomment-7'],
    ['/acme/widgets/pull/42#pullrequestreview-9', 'conversation', 'pullrequestreview-9'],
    ['/acme/widgets/pull/42#discussion_r501', 'conversation', 'discussion_r501'],
    // GitHub's files view names the same diff comment r<id>.
    ['/acme/widgets/pull/42/files#r501', 'files', 'discussion_r501'],
  ])('carries the comment a link to %s names into the PR route', (path, section, comment) => {
    expect(parseGitHubLocation(new URL(`https://github.com${path}`))).toEqual({ page: 'pr', repo: { owner: 'acme', name: 'widgets' }, number: 42, section, comment });
  });

  it.each(['#diff-0123abcd', '#diff-0123abcdR12', '#issue-', '#discussion_r', '#partial-pull-merging'])('names no comment for the anchor %s', (hash) => {
    expect(parseGitHubLocation(new URL(`https://github.com/acme/widgets/pull/42${hash}`))).not.toHaveProperty('comment');
  });

  it('leaves everything else, and opted-out pages, to GitHub', () => {
    expect(parseGitHubLocation(new URL('https://github.com/acme/widgets/pulls'))).toEqual({ page: 'none' });
    expect(parseGitHubLocation(new URL('https://github.com/pullsx'))).toEqual({ page: 'none' });
    expect(parseGitHubLocation(new URL('https://github.com/?gh=1'))).toEqual({ page: 'none' });
    expect(parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42?gh=1'))).toEqual({ page: 'none' });
    expect(parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42/commits/abc'))).toEqual({ page: 'none' });
    expect(parseGitHubLocation(new URL('https://gist.github.com/'))).toEqual({ page: 'none' });
  });

  it('carries shared views from the hash into the inbox route', () => {
    const views = [{ id: 'a', name: 'A', query: 'is:pr' }];
    expect(parseGitHubLocation(new URL(encodeViewsShareLink(views)))).toEqual({ page: 'inbox', importViews: views });
  });
});

describe('routeInApp', () => {
  const both = { showsOurs: (route: AppRoute) => route.page !== 'none', signedIn: true };

  it.each([
    ['https://github.com/acme/widgets/pull/41', { page: 'pr', repo: { owner: 'acme', name: 'widgets' }, number: 41, section: 'conversation' }],
    ['https://github.com/acme/widgets/pull/41/files', { page: 'pr', repo: { owner: 'acme', name: 'widgets' }, number: 41, section: 'files' }],
    ['https://github.com/acme/api/pull/7#discussion_r12', { page: 'pr', repo: { owner: 'acme', name: 'api' }, number: 7, section: 'conversation', comment: 'discussion_r12' }],
    ['https://github.com/', { page: 'inbox', importViews: null }],
  ])('moves to %s inside the app', (url, route) => {
    expect(routeInApp(new URL(url), both)).toEqual(route);
  });

  it.each([
    'https://github.com/acme/widgets/issues/3',
    'https://github.com/acme/widgets/pull/41/commits/abc',
    'https://github.com/acme/widgets/pull/41?gh=1',
    'https://github.com/pulls',
    'https://gist.github.com/acme/1',
    'http://github.com/acme/widgets/pull/41',
  ])('loads %s', (url) => {
    expect(routeInApp(new URL(url), both)).toBeNull();
  });

  it("loads a page this tab shows as GitHub's, and the homepage signed out", () => {
    const pullRequestsOnly = { showsOurs: (route: AppRoute) => route.page === 'pr', signedIn: true };
    expect(routeInApp(new URL('https://github.com/'), pullRequestsOnly)).toBeNull();
    expect(routeInApp(new URL('https://github.com/acme/widgets/pull/41'), pullRequestsOnly)).toMatchObject({ page: 'pr', number: 41 });
    expect(routeInApp(new URL('https://github.com/'), { ...both, signedIn: false })).toBeNull();
  });
});

describe('app hash round trip', () => {
  it('round-trips every route through the app hash', () => {
    const routes = [
      parseGitHubLocation(new URL('https://github.com/')),
      parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42')),
      parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42/files')),
      parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42#issuecomment-7')),
      parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42/files#r501')),
      parseGitHubLocation(new URL(encodeViewsShareLink([{ id: 'a', name: 'A', query: 'is:pr' }]))),
    ];
    for (const route of routes) expect(parseAppHash(toAppHash(route))).toEqual(route);
  });

  it('drops a comment that is not one of GitHub’s anchors from the app hash', () => {
    expect(parseAppHash('#/pr/acme/widgets/42?comment=javascript%3Aalert(1)')).not.toHaveProperty('comment');
  });

  it('drops malformed import payloads from the app hash', () => {
    expect(parseAppHash('#/inbox?import=' + encodeURIComponent('[{"id":1}]'))).toEqual({ page: 'inbox', importViews: null });
    expect(parseAppHash('#/inbox?import=' + encodeURIComponent('[]'))).toEqual({ page: 'inbox', importViews: null });
  });

  it('maps routes back to github.com URLs', () => {
    expect(toGitHubUrl(parseAppHash('#/pr/acme/widgets/42?section=files'))).toBe('https://github.com/acme/widgets/pull/42/files');
    expect(toGitHubUrl(parseAppHash('#/inbox'))).toBe('https://github.com/');
    expect(toGitHubUrl(parseAppHash('#/inbox?import=' + encodeURIComponent('[{"id":"a","name":"A","query":"is:pr"}]')))).toBe('https://github.com/');
  });
});
