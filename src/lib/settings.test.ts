import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { View } from './model';
import { getSettings, setSettings } from './settings';
import { DEFAULT_VIEWS } from './views';

// Chrome's synced storage, with its 8 KB a item limit.
const sync = vi.hoisted(() => ({ items: {} as Record<string, unknown>, writes: [] as string[][] }));
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      sync: {
        get: async () => structuredClone(sync.items),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) {
            if (key.length + JSON.stringify(value).length > 8192) throw new Error('Resource::kQuotaBytesPerItem quota exceeded');
          }
          sync.writes.push(Object.keys(items));
          Object.assign(sync.items, structuredClone(items));
        },
        remove: async (keys: string[]) => {
          for (const key of keys) delete sync.items[key];
        },
      },
    },
  },
}));

beforeEach(() => {
  sync.items = {};
  sync.writes = [];
});

describe('the inbox repositories', () => {
  it('searches the chosen repositories as one ORed scope', async () => {
    const inboxRepos = [
      { owner: 'acme', name: 'web' },
      { owner: 'acme', name: 'api' },
    ];
    expect(await setSettings({ inboxRepos })).toMatchObject({ inboxRepos, inboxScope: '(repo:acme/web OR repo:acme/api)' });
    expect(await setSettings({ inboxRepos: [] })).toMatchObject({ inboxRepos: [], inboxScope: '' });
  });

  it.each([
    ['repo:acme/web repo:acme/api', ['acme/web', 'acme/api']],
    ['(repo:acme/web OR repo:acme/api)', ['acme/web', 'acme/api']],
    ['org:acme repo:acme/web', []],
    ['', []],
  ])('reads a scope saved before the picker, %j, as the repositories chosen', async (inboxScope, chosen) => {
    sync.items = { settings: { inboxScope } };
    const settings = await getSettings();
    expect(settings.inboxRepos.map((repo) => `${repo.owner}/${repo.name}`)).toEqual(chosen);
    expect(settings.inboxScope).toBe(inboxScope);
  });
});

describe('views in synced storage', () => {
  const mine: View = { id: 'mine', name: 'Mine', query: 'is:pr author:@me' };

  it("keeps each view in an item of its own, under Chrome's 8 KB a item, and reads them back in order", async () => {
    const views = [...DEFAULT_VIEWS, mine];
    expect((await setSettings({ views, theme: 'dark' })).views).toEqual(views);
    expect(sync.items.settings).toEqual(expect.objectContaining({ theme: 'dark', viewOrder: views.map((view) => view.id) }));
    expect(sync.items.settings).not.toHaveProperty('views');
    expect(sync.items['view:mine']).toEqual(mine);
    expect((await getSettings()).views).toEqual(views);
  });

  it('writes only the views that changed and removes the ones deleted', async () => {
    await setSettings({ views: [mine, DEFAULT_VIEWS[0]!] });
    sync.writes = [];
    await setSettings({ views: [{ ...mine, collapsed: true }] });
    expect(sync.writes).toEqual([['settings', 'view:mine']]);
    expect(Object.keys(sync.items).sort()).toEqual(['settings', 'view:mine']);
  });

  it('moves views an earlier version kept inside settings into items of their own, once', async () => {
    sync.items = { settings: { theme: 'dark', views: [mine] } };
    expect(await getSettings()).toMatchObject({ theme: 'dark', views: [mine] });
    expect(sync.items).toEqual({ settings: { theme: 'dark', viewOrder: ['mine'] }, 'view:mine': mine });
    sync.writes = [];
    await getSettings();
    expect(sync.writes).toEqual([]);
  });

  it('passes a write Chrome refuses on to the caller, saying why', async () => {
    const huge: View = { ...mine, query: 'x'.repeat(9000) };
    await expect(setSettings({ views: [huge] })).rejects.toThrow("Chrome's synced settings are full (Resource::kQuotaBytesPerItem quota exceeded)");
  });
});

describe('organizations', () => {
  const acme = { login: 'acme', avatarUrl: 'https://github.com/acme.png?size=40', isViewer: false };
  const globex = { login: 'globex', avatarUrl: 'https://github.com/globex.png?size=40', isViewer: false };
  const mine: View = { id: 'mine', name: 'Mine', query: 'is:pr author:@me' };
  const theirs: View = { id: 'theirs', name: 'Theirs', query: 'is:pr -author:@me' };
  const beforeOrganizations = () => ({
    settings: { theme: 'dark', viewOrder: ['mine'], inboxRepos: [{ owner: 'acme', name: 'web' }, { owner: 'globex', name: 'api' }], inboxScope: '(repo:acme/web OR repo:globex/api)' },
    'view:mine': mine,
  });

  it('offers the views saved before organizations to the first one chosen, which keeps them with its own repositories', async () => {
    sync.items = beforeOrganizations();
    const before = await getSettings();
    expect(before).toMatchObject({ currentOrg: null, views: [mine], viewsUnassigned: true });
    expect(await setSettings({ currentOrg: acme, views: before.views, inboxRepos: before.inboxRepos })).toMatchObject({
      currentOrg: acme,
      views: [mine],
      viewsUnassigned: false,
      inboxRepos: [{ owner: 'acme', name: 'web' }],
      inboxScope: 'repo:acme/web',
      theme: 'dark',
    });
    expect(sync.items).toEqual({
      settings: { theme: 'dark', currentOrg: acme, viewsByOrg: { acme: { viewOrder: ['mine'] } }, reposByOrg: { acme: [{ owner: 'acme', name: 'web' }] } },
      'view:acme/mine': mine,
    });
  });

  it("gives an organization Graphite's defaults, stored nowhere, when the views from before are not kept", async () => {
    sync.items = beforeOrganizations();
    expect(await setSettings({ currentOrg: acme })).toMatchObject({ currentOrg: acme, views: DEFAULT_VIEWS, inboxRepos: [], inboxScope: 'org:acme', viewsUnassigned: false });
    expect(sync.items).toEqual({ settings: { theme: 'dark', currentOrg: acme } });
  });

  it('keeps each organization its own views, order, collapsed state and repositories', async () => {
    await setSettings({ currentOrg: acme, views: [mine, theirs], inboxRepos: [{ owner: 'acme', name: 'web' }] });
    await setSettings({ views: [{ ...theirs, collapsed: true }, mine] });
    expect(await setSettings({ currentOrg: globex })).toMatchObject({ views: DEFAULT_VIEWS, inboxRepos: [], inboxScope: 'org:globex' });
    await setSettings({ views: [theirs] });
    expect(await setSettings({ currentOrg: acme })).toMatchObject({ views: [{ ...theirs, collapsed: true }, mine], inboxScope: 'repo:acme/web' });
    expect(Object.keys(sync.items).sort()).toEqual(['settings', 'view:acme/mine', 'view:acme/theirs', 'view:globex/theirs']);
  });

  it('writes only the views of the organization that changed, and removes the ones deleted', async () => {
    await setSettings({ currentOrg: acme, views: [mine, theirs] });
    await setSettings({ currentOrg: globex, views: [mine] });
    await setSettings({ currentOrg: acme });
    sync.writes = [];
    await setSettings({ views: [{ ...mine, collapsed: true }] });
    expect(sync.writes).toEqual([['settings', 'view:acme/mine']]);
    expect(Object.keys(sync.items).sort()).toEqual(['settings', 'view:acme/mine', 'view:globex/mine']);
  });

  it("searches the viewer's own account as a user", async () => {
    expect((await setSettings({ currentOrg: { login: 'octocat', avatarUrl: '', isViewer: true } })).inboxScope).toBe('user:octocat');
  });
});

describe('settings this version cannot read', () => {
  it('reads a preference of another shape as its default, and keeps the keys it does not know when it saves', async () => {
    sync.items = { settings: { theme: 'sepia', diffLayout: 'split', fromAnotherVersion: { kept: true } } };
    expect(await getSettings()).toMatchObject({ theme: 'auto', diffLayout: 'split' });
    await setSettings({ prEnabled: false });
    expect(sync.items.settings).toMatchObject({ diffLayout: 'split', prEnabled: false, fromAnotherVersion: { kept: true } });
  });

  it('leaves out a saved view of another shape and keeps the others in order', async () => {
    const mine: View = { id: 'mine', name: 'Mine', query: 'is:pr author:@me' };
    sync.items = { settings: { viewOrder: ['broken', 'mine'] }, 'view:broken': { id: 'broken', name: 'Broken' }, 'view:mine': mine };
    expect((await getSettings()).views).toEqual([mine]);
  });
});

describe('views saved by earlier versions', () => {
  it("swap the earlier defaults for Graphite's, once", async () => {
    sync.items = {
      settings: {
        theme: 'dark',
        views: [
          { id: 'needs-review', name: 'Needs your review', query: 'inbox:review-requested', collapsed: true },
          { id: 'returned', name: 'Returned to you', query: 'inbox:needs-action' },
          { id: 'recently-merged', name: 'Merging and recently merged', query: 'is:pr author:@me is:merged merged:>={{7d}} sort:updated-desc', limit: 15 },
        ],
      },
    };
    expect(await getSettings()).toMatchObject({ theme: 'dark', views: DEFAULT_VIEWS });
    expect(sync.items.settings).toEqual({ theme: 'dark', viewOrder: DEFAULT_VIEWS.map((view) => view.id) });
    expect((await getSettings()).views).toEqual(DEFAULT_VIEWS);
  });

  it.each([
    ['a view of their own', [{ id: 'needs-review', name: 'Needs your review', query: 'inbox:review-requested' }, { id: 'mine', name: 'Mine', query: 'is:pr author:@me' }]],
    [
      'an earlier default edited in the section editor',
      [{ id: 'waiting-author', name: 'Waiting for author', query: 'is:pr reviewed-by:@me', filter: { groups: [{ rules: [{ isNegated: false, conditions: [{ kind: 'APPROVED_BY', username: '@me' }] }] }] } }],
    ],
    ['no views at all', []],
  ])('stay as they are with %s', async (_, views) => {
    sync.items = { settings: { views } };
    expect((await getSettings()).views).toEqual(views);
  });
});
