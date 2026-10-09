import { describe, expect, it } from 'vitest';
import { encodeViewsShareLink } from '../lib/views';
import { parseAppHash, parseGitHubLocation, toAppHash, toGitHubUrl } from './routes';

describe('parseGitHubLocation', () => {
  it('recognises the inbox and PR pages', () => {
    expect(parseGitHubLocation(new URL('https://github.com/pulls'))).toEqual({ page: 'inbox', importViews: null });
    expect(parseGitHubLocation(new URL('https://github.com/pulls?q=is%3Aopen'))).toEqual({ page: 'inbox', importViews: null });
    expect(parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42'))).toEqual({
      page: 'pr',
      repo: { owner: 'acme', name: 'widgets' },
      number: 42,
      section: 'conversation',
    });
    expect(parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42/files'))).toMatchObject({ page: 'pr', section: 'files' });
  });

  it('leaves everything else, and opted-out pages, to GitHub', () => {
    expect(parseGitHubLocation(new URL('https://github.com/acme/widgets/pulls'))).toEqual({ page: 'none' });
    expect(parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42?gh=1'))).toEqual({ page: 'none' });
    expect(parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42/commits/abc'))).toEqual({ page: 'none' });
    expect(parseGitHubLocation(new URL('https://gist.github.com/pulls'))).toEqual({ page: 'none' });
  });

  it('carries shared views from the hash into the inbox route', () => {
    const views = [{ id: 'a', name: 'A', query: 'is:pr' }];
    const route = parseGitHubLocation(new URL(encodeViewsShareLink(views)));
    expect(route).toEqual({ page: 'inbox', importViews: views });
  });
});

describe('app hash round trip', () => {
  it('round-trips every route through the app hash', () => {
    const routes = [
      parseGitHubLocation(new URL('https://github.com/pulls')),
      parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42')),
      parseGitHubLocation(new URL('https://github.com/acme/widgets/pull/42/files')),
      parseGitHubLocation(new URL(encodeViewsShareLink([{ id: 'a', name: 'A', query: 'is:pr' }]))),
    ];
    for (const route of routes) expect(parseAppHash(toAppHash(route))).toEqual(route);
  });

  it('drops malformed import payloads from the app hash', () => {
    expect(parseAppHash('#/inbox?import=' + encodeURIComponent('[{"id":1}]'))).toEqual({ page: 'inbox', importViews: null });
    expect(parseAppHash('#/inbox?import=' + encodeURIComponent('[]'))).toEqual({ page: 'inbox', importViews: null });
  });

  it('maps routes back to github.com URLs', () => {
    expect(toGitHubUrl(parseAppHash('#/pr/acme/widgets/42?section=files'))).toBe('https://github.com/acme/widgets/pull/42/files');
    expect(toGitHubUrl(parseAppHash('#/inbox'))).toBe('https://github.com/pulls');
  });
});
