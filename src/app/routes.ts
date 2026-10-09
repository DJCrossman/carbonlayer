// The two surfaces the extension takes over, parsed from either a github.com URL (content script)
// or the app's own location hash (iframe). Both sides agree on one `AppRoute` shape.

import type { RepoRef, View } from '../lib/model';
import { decodeViewsShareHash, isView } from '../lib/views';

export type AppRoute =
  | { page: 'inbox'; importViews: View[] | null }
  | { page: 'pr'; repo: RepoRef; number: number; section: 'conversation' | 'files' | 'commits' | 'checks' }
  | { page: 'none' };

/** Which surface, if any, a github.com URL belongs to. `?gh=1` opts out and yields 'none'. */
export function parseGitHubLocation(url: URL): AppRoute {
  if (url.hostname !== 'github.com' || url.searchParams.get('gh') === '1') return { page: 'none' };
  if (url.pathname === '/pulls' || url.pathname === '/pulls/') {
    return { page: 'inbox', importViews: decodeViewsShareHash(url.hash) };
  }
  // GitHub redirects /files to /changes, its new name for the tab.
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/(files|changes|commits|checks))?\/?$/.exec(url.pathname);
  if (match && match[1] && match[2] && match[3]) {
    const tab = match[4] ?? 'conversation';
    const section = tab === 'changes' ? 'files' : (tab as 'conversation' | 'files' | 'commits' | 'checks');
    return { page: 'pr', repo: { owner: match[1], name: match[2] }, number: Number(match[3]), section };
  }
  return { page: 'none' };
}

/** The app hash for a route, e.g. `#/pr/acme/widgets/42?section=files`. */
export function toAppHash(route: AppRoute): string {
  switch (route.page) {
    case 'inbox': {
      const params = new URLSearchParams();
      if (route.importViews) params.set('import', JSON.stringify(route.importViews));
      const query = params.toString();
      return `#/inbox${query ? `?${query}` : ''}`;
    }
    case 'pr': {
      const base = `#/pr/${route.repo.owner}/${route.repo.name}/${route.number}`;
      return route.section === 'conversation' ? base : `${base}?section=${route.section}`;
    }
    case 'none':
      return '#/';
  }
}

export function parseAppHash(hash: string): AppRoute {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  if (path === '/inbox') {
    const raw = params.get('import');
    let importViews: View[] | null = null;
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        importViews = Array.isArray(parsed) && parsed.length > 0 && parsed.every(isView) ? parsed : null;
      } catch {
        importViews = null;
      }
    }
    return { page: 'inbox', importViews };
  }
  const match = /^\/pr\/([^/]+)\/([^/]+)\/(\d+)$/.exec(path);
  if (match && match[1] && match[2] && match[3]) {
    const section = params.get('section');
    return {
      page: 'pr',
      repo: { owner: match[1], name: match[2] },
      number: Number(match[3]),
      section: section === 'files' || section === 'commits' || section === 'checks' ? section : 'conversation',
    };
  }
  return { page: 'none' };
}

/** The github.com URL for a route (used for top-level navigation and "open on GitHub"). */
export function toGitHubUrl(route: AppRoute): string {
  switch (route.page) {
    case 'inbox':
      return 'https://github.com/pulls';
    case 'pr': {
      const base = `https://github.com/${route.repo.owner}/${route.repo.name}/pull/${route.number}`;
      return route.section === 'conversation' ? base : `${base}/${route.section}`;
    }
    case 'none':
      return 'https://github.com/';
  }
}
