// The accounts whose pull requests the inbox can show: the owners of the repositories GitHub's repository picker offers
// the viewer (`contributed-by:@me`) together with the organizations their settings page lists (`GET
// /settings/organizations`, HTML, signed in), then the viewer's own account. Neither answer has been seen signed in, so
// both are read tolerantly: a source that fails or names nobody leaves the other's list as it is.

import type { Organization } from '../model';
import { repositoryCandidatesFrom, repositoryPickerPath } from './repositories';

/**
 * The viewer's organizations, by login, then their own account. `load` reaches github.com with the user's session (from
 * the content script, same-origin; from the options page, github.com itself). `viewerLogin` is who the page knows is
 * signed in, when it does; the settings page says too.
 */
export async function listOrganizations(load: { json: (path: string) => Promise<unknown>; page: (path: string) => Promise<Document> }, viewerLogin: string | null): Promise<Organization[]> {
  const [settingsPage, picker] = await Promise.allSettled([load.page('/settings/organizations'), load.json(repositoryPickerPath(''))]);
  for (const [route, result] of [['settings/organizations', settingsPage], ['repositories/picker/search', picker]] as const) {
    if (result.status === 'rejected') console.debug('[gg]', `${route} failed; the organizations come from elsewhere:`, result.reason instanceof Error ? result.reason.message : result.reason);
  }
  return organizationsFrom({
    settingsPage: settingsPage.status === 'fulfilled' ? settingsPage.value : null,
    repositoryOwners: picker.status === 'fulfilled' ? repositoryCandidatesFrom(picker.value).map((repo) => repo.owner) : [],
    viewerLogin,
  });
}

/**
 * The repositories' owners and the organizations a settings page lists (its rows' `/orgs/<login>`,
 * `/organizations/<login>/…` or `/<login>` links), each once and by login, without the viewer, whose own account comes
 * last.
 */
export function organizationsFrom({ settingsPage, repositoryOwners, viewerLogin }: { settingsPage: Document | null; repositoryOwners: string[]; viewerLogin: string | null }): Organization[] {
  const viewer = settingsPage?.querySelector('meta[name="user-login"]')?.getAttribute('content') || viewerLogin;
  const listed: string[] = [];
  for (const link of (settingsPage?.querySelector('main') ?? settingsPage?.body)?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []) {
    const path = new URL(link.getAttribute('href')!, 'https://github.com').pathname;
    const login =
      /^\/orgs\/([\w-]+)(?:\/|$)/.exec(path)?.[1] ??
      /^\/organizations\/([\w-]+)\//.exec(path)?.[1] ??
      // A row's own link to the organization's profile.
      (link.closest('.Box-row, li, tr') ? /^\/([\w-]+)\/?$/.exec(path)?.[1] : undefined);
    if (login && !NOT_ORGANIZATIONS.has(login.toLowerCase())) listed.push(login);
  }
  const byLogin = new Map<string, string>();
  for (const login of [...listed, ...repositoryOwners]) {
    if (login.toLowerCase() !== viewer?.toLowerCase() && !byLogin.has(login.toLowerCase())) byLogin.set(login.toLowerCase(), login);
  }
  const organizations = [...byLogin.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return [
    ...organizations.map((login) => ({ login, avatarUrl: `https://github.com/${login}.png?size=40`, isViewer: false })),
    ...(viewer ? [{ login: viewer, avatarUrl: `https://github.com/${viewer}.png?size=40`, isViewer: true }] : []),
  ];
}

/** Paths a settings page links to that name no organization. */
const NOT_ORGANIZATIONS = new Set(['new', 'settings', 'organizations', 'orgs', 'account', 'login', 'logout', 'notifications', 'pulls', 'issues', 'explore', 'marketplace', 'sponsors', 'features', 'enterprise', 'pricing', 'about', 'contact', 'site']);
