import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettings, setSettings } from './settings';
import { DEFAULT_VIEWS } from './views';

const stored = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }));
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      sync: {
        get: async () => ({ settings: stored.settings }),
        set: async ({ settings }: { settings: Record<string, unknown> }) => void (stored.settings = settings),
      },
    },
  },
}));

beforeEach(() => {
  stored.settings = {};
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
    stored.settings = { inboxScope };
    const settings = await getSettings();
    expect(settings.inboxRepos.map((repo) => `${repo.owner}/${repo.name}`)).toEqual(chosen);
    expect(settings.inboxScope).toBe(inboxScope);
  });
});

describe('views saved by earlier versions', () => {
  it("swap the earlier defaults for Graphite's, once", async () => {
    stored.settings = {
      theme: 'dark',
      views: [
        { id: 'needs-review', name: 'Needs your review', query: 'inbox:review-requested', collapsed: true },
        { id: 'returned', name: 'Returned to you', query: 'inbox:needs-action' },
        { id: 'recently-merged', name: 'Merging and recently merged', query: 'is:pr author:@me is:merged merged:>={{7d}} sort:updated-desc', limit: 15 },
      ],
    };
    expect(await getSettings()).toMatchObject({ theme: 'dark', views: DEFAULT_VIEWS });
    expect(stored.settings).toMatchObject({ theme: 'dark', views: DEFAULT_VIEWS });
  });

  it.each([
    ['a view of their own', [{ id: 'needs-review', name: 'Needs your review', query: 'inbox:review-requested' }, { id: 'mine', name: 'Mine', query: 'is:pr author:@me' }]],
    [
      'an earlier default edited in the section editor',
      [{ id: 'waiting-author', name: 'Waiting for author', query: 'is:pr reviewed-by:@me', filter: { groups: [{ rules: [{ isNegated: false, conditions: [{ kind: 'APPROVED_BY', username: '@me' }] }] }] } }],
    ],
    ['no views at all', []],
  ])('stay as they are with %s', async (_, views) => {
    stored.settings = { views };
    expect((await getSettings()).views).toEqual(views);
  });
});
