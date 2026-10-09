import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettings, setSettings } from './settings';

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
