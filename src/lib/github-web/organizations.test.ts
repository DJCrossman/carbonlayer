import { describe, expect, it, vi } from 'vitest';
import { listOrganizations, organizationsFrom } from './organizations';

describe('the organizations the inbox can show', () => {
  it.each([
    [
      'rows linking to /orgs/<login>',
      `<main><div class="Box-row"><a href="/orgs/Globex/dashboard">Globex</a></div><div class="Box-row"><a href="/orgs/acme">acme</a><a href="/organizations/acme/settings/profile">Settings</a></div></main>`,
    ],
    ['rows linking to /<login>', `<main><ul><li><a href="/acme">acme</a></li><li><a href="/Globex"><img alt="@Globex"></a></li></ul><a href="/organizations/new">New organization</a></main>`],
  ])("reads the settings page's %s, by login, the viewer's own account last", (_, main) => {
    const settingsPage = new DOMParser().parseFromString(`<html><head><meta name="user-login" content="octocat"></head><body>${main}</body></html>`, 'text/html');
    expect(organizationsFrom({ settingsPage, repositoryOwners: ['initech'], viewerLogin: null })).toEqual([
      { login: 'acme', avatarUrl: 'https://github.com/acme.png?size=40', isViewer: false },
      { login: 'Globex', avatarUrl: 'https://github.com/Globex.png?size=40', isViewer: false },
      { login: 'octocat', avatarUrl: 'https://github.com/octocat.png?size=40', isViewer: true },
    ]);
  });

  it('falls back on the owners of the repositories the picker offers when the settings page names nobody', () => {
    const settingsPage = new DOMParser().parseFromString('<html><body><main><a href="/settings/profile">Profile</a></main></body></html>', 'text/html');
    expect(organizationsFrom({ settingsPage, repositoryOwners: ['globex', 'octocat', 'acme', 'Globex'], viewerLogin: 'octocat' }).map((org) => [org.login, org.isViewer])).toEqual([
      ['acme', false],
      ['globex', false],
      ['octocat', true],
    ]);
    expect(organizationsFrom({ settingsPage: null, repositoryOwners: [], viewerLogin: null })).toEqual([]);
  });

  it('asks both sources, and does without the one that fails', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const page = vi.fn(async () => {
      throw new Error('Sign in to github.com in this tab, then reload.');
    });
    const json = vi.fn(async () => [{ name: 'web', ownerLogin: 'acme' }, { name: 'dotfiles', ownerLogin: 'octocat' }]);
    expect((await listOrganizations({ json, page }, 'octocat')).map((org) => org.login)).toEqual(['acme', 'octocat']);
    expect(page).toHaveBeenCalledWith('/settings/organizations');
    expect(json).toHaveBeenCalledWith('/repositories/picker/search?q=contributed-by%3A%40me');
  });
});
