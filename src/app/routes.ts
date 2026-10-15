// The two surfaces the extension takes over, parsed from either a github.com URL (content script)
// or the app's own location hash (iframe). Both sides agree on one `AppRoute` shape.

import { z } from 'zod/mini';
import { viewSchema, type RepoRef, type View } from '../lib/model';
import { decodeViewsShareHash } from '../lib/views';

export type AppRoute =
  | { page: 'inbox'; importViews: View[] | null }
  | {
      page: 'pr';
      repo: RepoRef;
      number: number;
      section: 'conversation' | 'files' | 'commits' | 'checks';
      /** The comment a GitHub link to the PR names, by its anchor (`discussion_r1`): the page opens at it. */
      comment?: string;
    }
  | { page: 'none' };

/** Which surface, if any, a github.com URL belongs to. `?gh=1` opts out and yields 'none'. */
export function parseGitHubLocation(url: URL): AppRoute {
  if (url.hostname !== 'github.com' || url.searchParams.get('gh') === '1') return { page: 'none' };
  // The homepage: signed in, GitHub's dashboard. Signed out it is GitHub's marketing page, which the content script
  // leaves alone.
  if (url.pathname === '/') return { page: 'inbox', importViews: decodeViewsShareHash(url.hash) };
  // GitHub redirects /files to /changes, its new name for the tab.
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/(files|changes|commits|checks))?\/?$/.exec(url.pathname);
  if (match && match[1] && match[2] && match[3]) {
    const tab = match[4] ?? 'conversation';
    const section = tab === 'changes' ? 'files' : (tab as 'conversation' | 'files' | 'commits' | 'checks');
    // GitHub's files view names a diff comment `#r<id>`, the conversation `#discussion_r<id>`.
    const comment = url.hash.slice(1).replace(/^r(?=\d+$)/, 'discussion_r');
    return { page: 'pr', repo: { owner: match[1], name: match[2] }, number: Number(match[3]), section, ...(COMMENT_ANCHOR.test(comment) && { comment }) };
  }
  return { page: 'none' };
}

/**
 * The route a move in this tab to `url` shows without loading a page, inside the app: a github.com page the app shows in
 * this tab (`showsOurs`), the homepage only signed in. Null for any other page, which loads as it would.
 */
export function routeInApp(url: URL, { showsOurs, signedIn }: { showsOurs: (route: AppRoute) => boolean; signedIn: boolean }): AppRoute | null {
  if (url.origin !== 'https://github.com') return null;
  const route = parseGitHubLocation(url);
  return showsOurs(route) && (route.page !== 'inbox' || signedIn) ? route : null;
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
      const params = new URLSearchParams();
      if (route.section !== 'conversation') params.set('section', route.section);
      if (route.comment) params.set('comment', route.comment);
      const query = params.toString();
      return `#/pr/${route.repo.owner}/${route.repo.name}/${route.number}${query ? `?${query}` : ''}`;
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
        importViews = z.array(viewSchema).check(z.minLength(1)).safeParse(parsed).data ?? null;
      } catch {
        importViews = null;
      }
    }
    return { page: 'inbox', importViews };
  }
  const match = /^\/pr\/([^/]+)\/([^/]+)\/(\d+)$/.exec(path);
  if (match && match[1] && match[2] && match[3]) {
    const section = params.get('section');
    const comment = params.get('comment');
    return {
      page: 'pr',
      repo: { owner: match[1], name: match[2] },
      number: Number(match[3]),
      section: section === 'files' || section === 'commits' || section === 'checks' ? section : 'conversation',
      ...(comment !== null && COMMENT_ANCHOR.test(comment) && { comment }),
    };
  }
  return { page: 'none' };
}

/** The github.com URL for a route (used for top-level navigation and "open on GitHub"). */
export function toGitHubUrl(route: AppRoute): string {
  switch (route.page) {
    case 'inbox':
      return 'https://github.com/';
    case 'pr': {
      const base = `https://github.com/${route.repo.owner}/${route.repo.name}/pull/${route.number}`;
      return route.section === 'conversation' ? base : `${base}/${route.section}`;
    }
    case 'none':
      return 'https://github.com/';
  }
}

/**
 * The anchors of GitHub's links to a PR's comments: the description (`issue-<id>`), a conversation comment
 * (`issuecomment-<id>`), a review (`pullrequestreview-<id>`) and a diff comment (`discussion_r<id>`).
 */
const COMMENT_ANCHOR = /^(?:issue-|issuecomment-|pullrequestreview-|discussion_r)\d+$/;
