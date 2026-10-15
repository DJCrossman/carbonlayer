// Inbox views: Graphite's default sections, each a GitHub search query (served by /pulls/search) or one of GitHub's own
// inbox sections (`inbox:<filter>`, served by /pulls/inbox/queries), plus the share-link format
// (`https://github.com/#views=<base64url json>`).

import { z } from 'zod';
import { viewSchema, type Organization, type RepoRef, type View, type ViewResult } from './model';

/**
 * Graphite's default inbox sections, the way its import translates them (the filters of the user's own Graphite
 * inbox, src/lib/graphite-inbox.fixture.json, with the viewer as @me and the inbox's repositories left to the inbox
 * scope), so the section editor shows their rows. Each `query` is what `searchForFilter` compiles from its `filter`,
 * written out because graphite.ts and this module import each other (this one through model.ts); views.test.ts holds
 * them equal, and each was checked against the user's live inbox (docs/research/graphite-sections.md, "Verified
 * mapping").
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
  return GITHUB_INBOX_FILTERS.find((filter) => filter === match?.[1]) ?? null;
}

/**
 * The count a section shows for its pull requests, the way Graphite writes it: the total, `99+` above 99, or `<limit>+`
 * when the view lists fewer than it found.
 */
export function sectionCount({ view, totalCount }: Pick<ViewResult, 'view' | 'totalCount'>): string {
  if (view.limit !== undefined && view.limit <= 99 && totalCount > view.limit) return `${view.limit}+`;
  return totalCount > 99 ? '99+' : String(totalCount);
}

/** A link that shares these views: their JSON as base64url (UTF-8) in the `views` hash parameter of the github.com homepage. */
export function encodeViewsShareLink(views: View[]): string {
  const json = JSON.stringify(views.map(({ id, name, query, filter, repos, limit }) => ({ id, name, query, filter, repos, limit })));
  let binary = '';
  for (const byte of new TextEncoder().encode(json)) binary += String.fromCharCode(byte);
  return `https://github.com/#views=${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** Views encoded in a location hash, or null when the hash carries none / is malformed (a link from anyone). */
export function decodeViewsShareHash(hash: string): View[] | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const encoded = params.get('views');
  if (!encoded) return null;
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '='));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
    return z.array(viewSchema).min(1).safeParse(parsed).data ?? null;
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
  // earlier imports and hand-written scopes have them, mean any of them. Those inside parentheses already say how they
  // combine: the middle ones of `(repo:a OR repo:b OR repo:c OR repo:d)` stand alone between ORs.
  const anyRepository = (text: string) => {
    const terms = text.trim().split(/\s+/);
    let depth = 0;
    const bare = terms.map((term) => {
      const outside = depth === 0 && /^repo:[^\s()]+$/.test(term);
      depth += term.split('(').length - term.split(')').length;
      return outside;
    });
    const repos = terms.filter((_, index) => bare[index]);
    if (repos.length < 2) return text.trim();
    const rest = terms.filter((_, index) => !bare[index]);
    rest.splice(bare.indexOf(true), 0, `(${repos.join(' OR ')})`);
    return rest.join(' ');
  };
  // A date alone counts the whole day: "merged in the last 7 days" needs the time too.
  const resolved = view.query.replace(/\{\{(\d+)d\}\}/g, (_, days: string) => `${new Date(now.getTime() - Number(days) * 86_400_000).toISOString().slice(0, 19)}Z`);
  const ownRepositories = /(^|[\s(])repo:/.test(view.query);
  return [ownRepositories ? '' : anyRepository(scope), anyRepository(resolved)].filter(Boolean).join(' ');
}

/**
 * What an organization's inbox searches: the repositories chosen for it, or else every repository the organization owns
 * (`org:`), or, for the viewer's own account, every one they own (`user:`).
 */
export function organizationScope(org: Pick<Organization, 'login' | 'isViewer'>, repos: RepoRef[]): string {
  return repos.length > 0 ? repositoryScope(repos) : `${org.isViewer ? 'user' : 'org'}:${org.login}`;
}

/**
 * The search scope selecting pull requests in any of these repositories. GitHub's dashboard search ANDs repeated
 * `repo:` terms, so several are one `(repo:a OR repo:b)`.
 */
export function repositoryScope(repos: Array<{ owner: string; name: string }>): string {
  const terms = repos.map((repo) => `repo:${repo.owner}/${repo.name}`);
  return terms.length > 1 ? `(${terms.join(' OR ')})` : (terms[0] ?? '');
}

