import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEWS, decodeViewsShareHash, encodeViewsShareLink, inboxFilterOf, resolveViewQuery } from './views';

describe('share links', () => {
  it('round-trips the default views through a share link', () => {
    const link = encodeViewsShareLink(DEFAULT_VIEWS);
    expect(link.startsWith('https://github.com/#views=')).toBe(true);
    const hash = new URL(link).hash;
    const decoded = decodeViewsShareHash(hash);
    expect(decoded?.map((v) => v.query)).toEqual(DEFAULT_VIEWS.map((v) => v.query));
  });

  it('rejects hashes without views or with malformed payloads', () => {
    expect(decodeViewsShareHash('')).toBeNull();
    expect(decodeViewsShareHash('#other=1')).toBeNull();
    expect(decodeViewsShareHash('#views=not-base64!')).toBeNull();
    expect(decodeViewsShareHash('#views=' + btoa('[{"id":1}]'))).toBeNull();
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
    expect(resolveViewQuery(view, 'repo:acme/web repo:acme/api repo:acme/ios')).toBe(
      '(repo:acme/web OR repo:acme/api OR repo:acme/ios) is:pr (repo:acme/web OR repo:acme/api) author:@me',
    );
    expect(resolveViewQuery({ ...view, query: 'is:pr repo:acme/web' }, '(repo:acme/web OR repo:acme/api)')).toBe('(repo:acme/web OR repo:acme/api) is:pr repo:acme/web');
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
