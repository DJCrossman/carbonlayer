// Inbox views: Graphite's default sections, each a GitHub search query (served by /pulls/search) or one of GitHub's own
// inbox sections (`inbox:<filter>`, served by /pulls/inbox/queries), plus the share-link format
// (`https://github.com/#views=<base64url json>`).

import { isGraphiteFilter } from './graphite';
import type { View } from './model';

/**
 * Graphite's default inbox sections, as its import translates them (the filters of the user's own Graphite inbox,
 * src/lib/graphite-inbox.fixture.json, with the viewer as @me and the inbox's repositories left to the inbox scope), so
 * the section editor shows their rows. Each `query` is what `searchForFilter` compiles from its `filter`, written out
 * because graphite.ts and this module import each other; views.test.ts holds them equal, and each was checked against
 * the user's live inbox (docs/research/graphite-sections.md, "Verified mapping").
 */
export const DEFAULT_VIEWS: View[] = [
  {
    id: 'graphite-needs-your-review',
    name: 'Needs your review',
    query: 'is:pr -author:@me is:open draft:false review-requested:@me -review:changes_requested sort:updated-desc',
    filter: {
      groups: [
        {
          rules: [
            { isNegated: true, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] },
            { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }, { kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: false, conditions: [{ kind: 'OPEN_REVIEW_REQUEST_FOR', username: '@me' }] },
            { isNegated: true, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'HAS_UNADDRESSED_CHANGES_REQUESTED' }] },
            { isNegated: true, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'IS_FULLY_APPROVED' }] },
          ],
        },
        {
          rules: [
            { isNegated: true, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] },
            { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }, { kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: false, conditions: [{ kind: 'OPEN_REVIEW_REQUEST_FOR', username: '@me' }] },
            { isNegated: true, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'HAS_UNADDRESSED_CHANGES_REQUESTED' }] },
            { isNegated: true, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'ONE_OR_MORE_APPROVALS' }] },
          ],
        },
        {
          rules: [
            { isNegated: true, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] },
            { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }, { kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: false, conditions: [{ kind: 'REOPENED_REVIEW_REQUEST_FOR', username: '@me' }] },
            { isNegated: true, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'HAS_UNADDRESSED_CHANGES_REQUESTED' }] },
          ],
        },
      ],
    },
  },
  {
    id: 'graphite-returned-to-you',
    name: 'Returned to you',
    query: 'is:pr is:open draft:false author:@me review:changes_requested sort:updated-desc',
    filter: {
      groups: [
        {
          rules: [
            { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }, { kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] },
            { isNegated: true, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'IS_FULLY_APPROVED' }] },
            { isNegated: false, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'HAS_ACTIVE_REVIEW' }] },
          ],
        },
        {
          rules: [
            { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }, { kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] },
            { isNegated: true, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'ONE_OR_MORE_APPROVALS' }] },
            { isNegated: false, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'HAS_ACTIVE_REVIEW' }] },
          ],
        },
        {
          rules: [
            { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }, { kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] },
            { isNegated: false, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'HAS_UNADDRESSED_CHANGES_REQUESTED' }] },
          ],
        },
      ],
    },
  },
  {
    id: 'graphite-approved',
    name: 'Approved',
    query: 'is:pr is:open draft:false author:@me review:approved -review:changes_requested sort:updated-desc',
    filter: {
      groups: [
        {
          rules: [
            { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }, { kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] },
            { isNegated: false, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'ONE_OR_MORE_APPROVALS' }] },
            { isNegated: false, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'IS_FULLY_APPROVED' }] },
            { isNegated: true, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'HAS_UNADDRESSED_CHANGES_REQUESTED' }] },
          ],
        },
      ],
    },
  },
  {
    id: 'graphite-waiting-for-reviewers',
    name: 'Waiting for reviewers',
    query: 'is:pr author:@me is:open draft:false -review:approved -review:changes_requested sort:updated-desc',
    filter: {
      groups: [
        {
          rules: [
            { isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }, { kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
            { isNegated: true, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'HAS_ACTIVE_REVIEW' }] },
            { isNegated: true, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'IS_FULLY_APPROVED' }] },
          ],
        },
        {
          rules: [
            { isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }, { kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
            { isNegated: true, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'HAS_ACTIVE_REVIEW' }] },
            { isNegated: true, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'ONE_OR_MORE_APPROVALS' }] },
          ],
        },
      ],
    },
  },
  {
    id: 'graphite-drafts',
    name: 'Drafts',
    query: 'is:pr author:@me is:open draft:true sort:updated-desc',
    filter: {
      groups: [
        {
          rules: [
            { isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }] },
            { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
          ],
        },
      ],
    },
  },
  {
    id: 'graphite-needs-anyones-review',
    name: "Needs anyone's review",
    query: 'is:pr is:open -author:dependabot -author:app/dependabot -author:@me review:none draft:false sort:updated-desc',
    filter: {
      groups: [
        {
          rules: [
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: true, conditions: [{ kind: 'AUTHOR_IS', username: 'dependabot' }, { kind: 'AUTHOR_IS', username: '@me' }] },
            { isNegated: false, conditions: [{ kind: 'REVIEW_STATUS_IS', state: 'REVIEW_REQUIRED_GITHUB' }] },
          ],
        },
      ],
    },
  },
  {
    id: 'graphite-merging-and-recently-merged',
    name: 'Merging and recently merged',
    query: 'is:pr is:merged merged:>={{7d}} sort:updated-desc',
    filter: {
      groups: [
        {
          rules: [
            { isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
          ],
        },
        {
          rules: [
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGED' }] },
            { isNegated: false, conditions: [{ kind: 'LAST_UPDATED', hours: 168 }] },
          ],
        },
      ],
    },
  },
  {
    id: 'graphite-waiting-for-author',
    name: 'Waiting for author',
    query: 'is:pr is:open draft:false reviewed-by:@me -review-requested:@me -author:@me sort:updated-desc',
    filter: {
      groups: [
        {
          rules: [
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }, { kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
            { isNegated: false, conditions: [{ kind: 'CLOSED_REVIEW_REQUEST_FROM', username: '@me' }] },
            { isNegated: true, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] },
          ],
        },
        {
          rules: [
            { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] },
            { isNegated: true, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }, { kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'MERGING' }] },
            { isNegated: false, conditions: [{ kind: 'APPROVED_BY', username: '@me' }] },
            { isNegated: true, conditions: [{ kind: 'REOPENED_REVIEW_REQUEST_FOR', username: '@me' }] },
          ],
        },
      ],
    },
  },
];

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

/** A link that shares these views: their JSON as base64url (UTF-8) in the `views` hash parameter of the github.com homepage. */
export function encodeViewsShareLink(views: View[]): string {
  const json = JSON.stringify(views.map(({ id, name, query, filter, repos, limit }) => ({ id, name, query, filter, repos, limit })));
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

/**
 * The query GitHub sees: `{{7d}}`-style relative times resolved to the moment that long before `now`, and the inbox
 * scope prepended unless the query names repositories of its own, which it then searches instead, as a Graphite section
 * with its own repositories does. `inbox:<filter>` views are returned unchanged (GitHub scopes them with its own repo
 * picker).
 */
export function resolveViewQuery(view: View, scope: string, now = new Date()): string {
  if (inboxFilterOf(view)) return view.query.trim();
  // GitHub's dashboard search ANDs repeated repo: terms (no pull request is in two repositories), so bare ones, as
  // earlier imports and hand-written scopes have them, mean any of them.
  const anyRepository = (text: string) => {
    const terms = text.trim().split(/\s+/);
    const repos = terms.filter((term) => /^repo:[^\s()]+$/.test(term));
    if (repos.length < 2) return text.trim();
    const rest = terms.filter((term) => !repos.includes(term));
    rest.splice(terms.indexOf(repos[0]!), 0, `(${repos.join(' OR ')})`);
    return rest.join(' ');
  };
  // A date alone counts the whole day: "merged in the last 7 days" needs the time too.
  const resolved = view.query.replace(/\{\{(\d+)d\}\}/g, (_, days: string) => `${new Date(now.getTime() - Number(days) * 86_400_000).toISOString().slice(0, 19)}Z`);
  const ownRepositories = /(^|[\s(])repo:/.test(view.query);
  return [ownRepositories ? '' : anyRepository(scope), anyRepository(resolved)].filter(Boolean).join(' ');
}

/**
 * The search scope selecting pull requests in any of these repositories. GitHub's dashboard search ANDs repeated
 * `repo:` terms, so several are one `(repo:a OR repo:b)`.
 */
export function repositoryScope(repos: Array<{ owner: string; name: string }>): string {
  const terms = repos.map((repo) => `repo:${repo.owner}/${repo.name}`);
  return terms.length > 1 ? `(${terms.join(' OR ')})` : (terms[0] ?? '');
}

export function isView(value: unknown): value is View {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.query === 'string' &&
    (v.filter === undefined || isGraphiteFilter(v.filter)) &&
    (v.repos === undefined ||
      (Array.isArray(v.repos) && v.repos.every((repo: unknown) => typeof (repo as { owner?: unknown })?.owner === 'string' && typeof (repo as { name?: unknown })?.name === 'string'))) &&
    (v.limit === undefined || typeof v.limit === 'number') &&
    (v.collapsed === undefined || typeof v.collapsed === 'boolean')
  );
}
