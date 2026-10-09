// Inbox views: Graphite's default sections, each either one of GitHub's own inbox sections
// (`inbox:<filter>`, served by /pulls/inbox/queries) or a GitHub search query (served by
// /pulls/search), plus the share-link format (`https://github.com/#views=<base64url json>`).

import type { View } from './model';

/** GitHub's built-in inbox sections, usable as a view query `inbox:<id>`. */
export const GITHUB_INBOX_FILTERS = [
  'review-requested',
  'team-review-requested',
  'your-drafts',
  'waiting-for-review',
  'needs-action',
  'ready-to-merge',
  'merge-queue',
] as const;

export type GitHubInboxFilter = (typeof GITHUB_INBOX_FILTERS)[number];

export function inboxFilterOf(view: View): GitHubInboxFilter | null {
  const match = /^inbox:([a-z-]+)$/.exec(view.query.trim());
  const filter = match?.[1] as GitHubInboxFilter | undefined;
  return filter && GITHUB_INBOX_FILTERS.includes(filter) ? filter : null;
}

export const DEFAULT_VIEWS: View[] = [
  { id: 'needs-review', name: 'Needs your review', query: 'inbox:review-requested' },
  { id: 'team-review', name: "Needs your team's review", query: 'inbox:team-review-requested' },
  { id: 'returned', name: 'Returned to you', query: 'inbox:needs-action' },
  { id: 'approved', name: 'Ready to merge', query: 'inbox:ready-to-merge' },
  { id: 'drafts', name: 'Drafts', query: 'inbox:your-drafts' },
  { id: 'waiting-reviewers', name: 'Waiting for review or checks', query: 'inbox:waiting-for-review' },
  { id: 'recently-merged', name: 'Merging and recently merged', query: 'is:pr author:@me is:merged merged:>={{7d}} sort:updated-desc', limit: 15 },
  { id: 'waiting-author', name: 'Waiting for author', query: 'is:pr is:open -author:@me reviewed-by:@me -review-requested:@me sort:updated-desc' },
];

/** A link that shares these views: their JSON as base64url (UTF-8) in the `views` hash parameter of the github.com homepage. */
export function encodeViewsShareLink(views: View[]): string {
  const json = JSON.stringify(views.map(({ id, name, query, limit }) => ({ id, name, query, limit })));
  let binary = '';
  for (const byte of new TextEncoder().encode(json)) binary += String.fromCharCode(byte);
  return `https://github.com/#views=${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** Views encoded in a location hash, or null when the hash carries none / is malformed. */
export function decodeViewsShareHash(hash: string): View[] | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const encoded = params.get('views');
  if (!encoded) return null;
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '='));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
    if (!Array.isArray(parsed)) return null;
    const views = parsed.filter(isView);
    return views.length === parsed.length && views.length > 0 ? views : null;
  } catch {
    return null;
  }
}

/** Resolves `{{7d}}`-style relative dates and prepends the global scope, producing the query GitHub sees.
 *  `inbox:<filter>` views are returned unchanged (GitHub scopes them with its own repo picker). */
export function resolveViewQuery(view: View, scope: string, now = new Date()): string {
  if (inboxFilterOf(view)) return view.query.trim();
  const resolved = view.query.replace(/\{\{(\d+)d\}\}/g, (_, days: string) => {
    const date = new Date(now.getTime() - Number(days) * 86_400_000);
    return date.toISOString().slice(0, 10);
  });
  return [scope.trim(), resolved.trim()].filter(Boolean).join(' ');
}

export function isView(value: unknown): value is View {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.query === 'string' &&
    (v.limit === undefined || typeof v.limit === 'number') &&
    (v.collapsed === undefined || typeof v.collapsed === 'boolean')
  );
}
