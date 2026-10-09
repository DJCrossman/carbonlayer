import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEWS, decodeViewsShareHash, encodeViewsShareLink, inboxFilterOf, resolveViewQuery } from './views';

describe('share links', () => {
  it('round-trips the default views through a share link', () => {
    const link = encodeViewsShareLink(DEFAULT_VIEWS);
    expect(link.startsWith('https://github.com/pulls#views=')).toBe(true);
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
  it('expands relative dates and prepends the scope', () => {
    const view = { id: 'm', name: 'Merged', query: 'is:merged merged:>={{7d}}' };
    expect(resolveViewQuery(view, 'org:acme', new Date('2026-10-09T12:00:00Z'))).toBe('is:merged merged:>=2026-10-02 org:acme'.replace('org:acme', '').trim().replace(/^/, 'org:acme '));
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
