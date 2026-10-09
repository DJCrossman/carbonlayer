// Inbox views: Graphite's default sections expressed as GitHub search queries, plus the share-link
// format (`https://github.com/pulls#views=<base64url json>`).

import type { View } from './model';

export const DEFAULT_VIEWS: View[] = [
  { id: 'needs-review', name: 'Needs your review', query: 'is:pr is:open draft:false review-requested:@me -author:@me -review:approved' },
  { id: 'returned', name: 'Returned to you', query: 'is:pr is:open author:@me review:changes_requested' },
  { id: 'approved', name: 'Approved', query: 'is:pr is:open author:@me draft:false review:approved' },
  { id: 'drafts', name: 'Drafts', query: 'is:pr is:open author:@me draft:true' },
  { id: 'waiting-reviewers', name: 'Waiting for reviewers', query: 'is:pr is:open author:@me draft:false -review:approved -review:changes_requested' },
  { id: 'recently-merged', name: 'Merging and recently merged', query: 'is:pr author:@me is:merged merged:>={{7d}}', limit: 15 },
  { id: 'waiting-author', name: 'Waiting for author', query: 'is:pr is:open -author:@me reviewed-by:@me -review-requested:@me' },
];

export const SHARE_HASH_KEY = 'views';

export function encodeViewsShareLink(views: View[]): string {
  const json = JSON.stringify(views.map(({ id, name, query, limit }) => ({ id, name, query, limit })));
  return `https://github.com/pulls#${SHARE_HASH_KEY}=${base64UrlEncode(json)}`;
}

/** Views encoded in a location hash, or null when the hash carries none / is malformed. */
export function decodeViewsShareHash(hash: string): View[] | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const encoded = params.get(SHARE_HASH_KEY);
  if (!encoded) return null;
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(encoded));
    if (!Array.isArray(parsed)) return null;
    const views = parsed.filter(isView);
    return views.length === parsed.length && views.length > 0 ? views : null;
  } catch {
    return null;
  }
}

/** Resolves `{{7d}}`-style relative dates and prepends the global scope, producing the query GitHub sees. */
export function resolveViewQuery(view: View, scope: string, now = new Date()): string {
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

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
