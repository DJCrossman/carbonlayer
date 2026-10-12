// Importing views from a shared inbox link, or from Graphite into one of the viewer's organizations.
import { searchForFilter } from '../lib/graphite';
import type { Organization, RepoRef, View } from '../lib/model';
import { repositoryScope } from '../lib/views';

/**
 * The view list after importing `incoming`: `replace` swaps the whole list, `append` adds the incoming views after the
 * current ones, except that an incoming view named like one already there (case aside) takes that view's place and keeps
 * its id, so importing the same sections twice updates them instead of listing them twice. Any other view whose id is
 * already taken (by a kept view, or earlier in the link) gets a fresh id, so every copy survives.
 */
export function importViews(current: View[], incoming: View[], mode: 'replace' | 'append'): View[] {
  const views = mode === 'replace' ? [] : [...current];
  for (const view of incoming) {
    const sameName = mode === 'append' ? views.findIndex((kept) => kept.name.trim().toLowerCase() === view.name.trim().toLowerCase()) : -1;
    if (sameName >= 0) {
      views[sameName] = { ...view, id: views[sameName]!.id };
      continue;
    }
    views.push(views.some((kept) => kept.id === view.id) ? { ...view, id: crypto.randomUUID() } : view);
  }
  return views;
}

/**
 * Where sections imported from Graphite go, with Graphite's inbox repositories. When one of the viewer's organizations
 * owns them all, they become that organization's inbox repositories and the sections its views. Otherwise the sections
 * go to the current organization, and each that searched Graphite's inbox repositories (one without repositories of its
 * own) searches them itself.
 */
export function placeGraphiteImport(views: View[], inboxRepos: RepoRef[], current: Organization, organizations: Organization[]): { org: Organization; views: View[]; inboxRepos?: RepoRef[] } {
  const owners = new Set(inboxRepos.map((repo) => repo.owner.toLowerCase()));
  const owner = owners.size === 1 ? [current, ...organizations].find((org) => owners.has(org.login.toLowerCase())) : undefined;
  if (owner) return { org: owner, views, inboxRepos };
  return {
    org: current,
    views: views.map((view) =>
      view.repos?.length || inboxRepos.length === 0
        ? view
        : { ...view, repos: inboxRepos, query: (view.filter && searchForFilter(view.filter, inboxRepos).query) || `${repositoryScope(inboxRepos)} ${view.query}` },
    ),
  };
}
