// The inbox. Each view is one of GitHub's own inbox sections (`inbox:<filter>` → /pulls/inbox/queries) or a
// search (/pulls/search); the rows shown then get their "deferred" fields (review decision, CI rollup), and the rows on
// screen later what the dashboard has not at all (mergeability, reviewers, line counts) from each PR's page data.

import type { CheckState, PrEnrichment, PrSummary, View, ViewResult } from '../model';
import type { MergeMethod } from '../rpc';
import { inboxFilterOf, resolveViewQuery, type GitHubInboxFilter } from '../views';
import { mergeState } from './merge-box';
import { reviewersOf } from './reviews';
import { embeddedPayload, findInPayload, getJson, githubUser, noteShape, politely, request } from './session';

/** Every view's rows, three views at a time so at most three requests are in flight. */
export async function fetchInbox(views: View[], scope: string): Promise<ViewResult[]> {
  return politely(views, 3, (view) => fetchView(view, scope));
}

async function fetchView(view: View, scope: string): Promise<ViewResult> {
  const section = inboxFilterOf(view);
  const query = resolveViewQuery(view, scope);
  let found: { pulls: Pull[]; totalCount: number };
  if (section) {
    const data = await getJson<unknown>(`/pulls/inbox/queries?filter=${section}&max_pr_age=1m`);
    noteShape('inbox/queries', data);
    found = pullsIn(data);
  } else {
    found = await searchPulls(query);
  }
  const shown = found.pulls.slice(0, view.limit ?? 50);
  const deferred = await deferredFields(shown, section ? { section } : { query });
  return {
    view,
    prs: shown.map((pull) => summarisePull({ ...pull, ...deferred.get(pull.id) }, section)),
    totalCount: found.totalCount,
    fetchedAt: new Date().toISOString(),
  };
}

/** Rows and their total from a section or search answer: `{ results, totalCount | pageInfo }`, `{ pulls }` or a bare array. */
function pullsIn(data: unknown): { pulls: Pull[]; totalCount: number } {
  const record = (data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(data) ? data : Array.isArray(record.results) ? record.results : Array.isArray(record.pulls) ? record.pulls : [];
  const pulls = rows.filter((row): row is Pull => {
    const pull = row as Partial<Pull> | null;
    return typeof pull?.id === 'string' && typeof pull.number === 'number' && (pull.itemType === undefined || pull.itemType === 'pull_request');
  });
  const pageInfo = record.pageInfo as { totalCount?: unknown } | undefined;
  const totalCount = typeof record.totalCount === 'number' ? record.totalCount : typeof pageInfo?.totalCount === 'number' ? pageInfo.totalCount : pulls.length;
  return { pulls, totalCount };
}

/** A search's first page of rows, as GitHub's dashboard renders it. Also used for stack neighbours. */
export async function searchPulls(query: string): Promise<{ pulls: Pull[]; totalCount: number }> {
  const response = await request(`/pulls/search?${new URLSearchParams({ q: query })}`, 'application/json');
  if (response.headers.get('content-type')?.includes('json')) {
    const data = (await response.json()) as { payload?: Record<string, unknown> } | null;
    noteShape('pulls/search (JSON)', data);
    return pullsIn(data?.payload?.pullsDashboardSurfaceContentRoute ?? data);
  }
  const page = new DOMParser().parseFromString(await response.text(), 'text/html');
  return pullsIn(embeddedPayload(page, 'pullsDashboardSurfaceContentRoute')?.payload.pullsDashboardSurfaceContentRoute);
}

/**
 * The deferred fields (review decision, CI rollup, review counts) of these rows, by PR id. The rows still show without
 * them, so a failure is logged and yields none.
 */
export async function deferredFields(pulls: Pull[], search: { section: GitHubInboxFilter } | { query: string }): Promise<Map<string, Partial<Pull>>> {
  if (pulls.length === 0) return new Map();
  const params = new URLSearchParams('section' in search ? { page: '1' } : { q: search.query, page: '1' });
  for (const pull of pulls) params.append('ids[]', pull.id);
  let data: unknown;
  try {
    data = await getJson<unknown>(`${'section' in search ? '/pulls/inbox/deferred' : '/pulls/deferred'}?${params}`);
  } catch (error) {
    console.debug('[gg]', 'deferred fields failed; showing the rows without review and CI status:', error instanceof Error ? error.message : error);
    return new Map();
  }
  noteShape('deferred', data);
  // Expected an array of rows or { results | pulls: rows }; also accepts an object keyed by PR id.
  const record = (data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(data) ? data : Array.isArray(record.results) ? record.results : Array.isArray(record.pulls) ? record.pulls : null;
  if (!rows) {
    return new Map(Object.entries(record).filter((entry): entry is [string, Partial<Pull>] => typeof entry[1] === 'object' && entry[1] !== null));
  }
  return new Map(rows.filter((row): row is Pull => typeof (row as Partial<Pull> | null)?.id === 'string').map((row) => [row.id, row]));
}

/** A dashboard row as the inbox shows it: the section or search fields plus its deferred fields. */
export function summarisePull(pull: Pull, section: GitHubInboxFilter | null): PrSummary {
  const [owner = '', name = ''] = pull.repoNameWithOwner?.split('/') ?? [];
  const rollup = pull.statusCheckRollup;
  const rollupState = rollup?.state?.toUpperCase();
  const ciState: CheckState =
    !rollup || rollup.totalCount === 0
      ? 'NONE'
      : rollupState === 'SUCCESS'
        ? 'SUCCESS'
        : rollupState === 'FAILURE' || rollupState === 'ERROR'
          ? 'FAILURE'
          : rollupState === 'PENDING' || rollupState === 'EXPECTED'
            ? 'PENDING'
            : 'NONE';
  const notPassing = rollup ? rollup.totalCount - rollup.successCount : 0;
  const decision = pull.reviewDecisionState?.toUpperCase();
  const isDraft = pull.isDraft ?? pull.displayState === 'DRAFT';
  return {
    id: pull.id,
    repo: { owner, name },
    number: pull.number,
    title: pull.title ?? '',
    url: pull.permalink ?? `https://github.com/${owner}/${name}/pull/${pull.number}`,
    author: githubUser(pull.author?.displayLogin ?? 'ghost'),
    state: pull.mergedAt || pull.state === 'MERGED' ? 'MERGED' : pull.closedAt || pull.state === 'CLOSED' ? 'CLOSED' : 'OPEN',
    isDraft,
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
    mergedAt: pull.mergedAt ?? null,
    // Not in the dashboard data.
    headRefName: '',
    baseRefName: '',
    reviewDecision: decision === 'APPROVED' || decision === 'CHANGES_REQUESTED' || decision === 'REVIEW_REQUIRED' ? decision : 'NONE',
    reviewers: [],
    // The dashboard has only a rollup (state, total, passing), no per-check detail.
    ci: {
      state: ciState,
      checks: [],
      counts: {
        success: rollup?.successCount ?? 0,
        failure: ciState === 'FAILURE' ? notPassing : 0,
        pending: ciState === 'PENDING' ? notPassing : 0,
        other: 0,
      },
    },
    // The dashboard does not expose mergeability; GitHub's own ready-to-merge section vouches for it.
    mergeStatus: isDraft ? 'DRAFT' : pull.category === 'READY_TO_MERGE' || section === 'ready-to-merge' ? 'CLEAN' : 'UNKNOWN',
    // Not in the dashboard data: 0 means unknown here.
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    labels: (pull.labels ?? []).map((label) => ({ name: label.name, color: label.color })),
    commentCount: pull.commentCount ?? 0,
    unread: pull.isReadByCurrentUser == null ? null : !pull.isReadByCurrentUser,
    isInMergeQueue: section === 'merge-queue',
    autoMerge: null,
    nativeStack: pull.stackPosition != null && pull.stackSize != null ? { position: pull.stackPosition, size: pull.stackSize } : null,
  };
}

/**
 * What GitHub's dashboard leaves out of a row, from the PR's own page data: mergeability, and reviewers when it names
 * them (`latestOpinionatedReviews`, pending requests), from its merge box (`page_data/merge_box`, read as the PR page
 * reads it), and line counts from `page_data/diffstat`. A draft's merge status is DRAFT and a merged or closed PR's is its
 * state, so neither asks the merge box. A route that fails is logged and leaves its fields out: the row keeps what it had.
 */
export async function enrichPull(pr: Pick<PrSummary, 'repo' | 'number' | 'state' | 'isDraft'>, mergeMethod: MergeMethod): Promise<PrEnrichment> {
  const data = `/${pr.repo.owner}/${pr.repo.name}/pull/${pr.number}/page_data`;
  const asksMergeBox = pr.state === 'OPEN' && !pr.isDraft;
  const [mergeBox, diffstat] = await Promise.allSettled([
    asksMergeBox ? getJson<unknown>(`${data}/merge_box?merge_method=${mergeMethod}&bypass_requirements=false`) : null,
    getJson<{ diffstat?: { linesAdded?: number; linesDeleted?: number } }>(`${data}/diffstat`),
  ]);
  const found: PrEnrichment = pr.state === 'OPEN' && pr.isDraft ? { mergeStatus: 'DRAFT' } : {};
  if (asksMergeBox && mergeBox.status === 'fulfilled') {
    const merge = mergeState(mergeBox.value, { isDraft: false, isOpen: true });
    found.mergeStatus = merge.mergeStatus;
    const pendingReviewRequests = findInPayload(mergeBox.value, (key) => key === 'pendingReviewRequests' || key === 'pendingRequestedReviews');
    if (merge.latestOpinionatedReviews != null || pendingReviewRequests !== undefined) {
      // The dashboard has no timeline to add commenters from; the author is never among a PR's reviewers here.
      found.reviewers = reviewersOf({ requests: { pendingReviewRequests }, latestOpinionatedReviews: merge.latestOpinionatedReviews, timeline: [], author: '' });
    }
  } else if (mergeBox.status === 'rejected') {
    const reason: unknown = mergeBox.reason;
    console.debug('[gg]', `page_data/merge_box for ${pr.repo.owner}/${pr.repo.name}#${pr.number} failed; the row keeps its merge status:`, reason instanceof Error ? reason.message : reason);
  }
  if (diffstat.status === 'fulfilled' && diffstat.value.diffstat) {
    found.additions = diffstat.value.diffstat.linesAdded ?? 0;
    found.deletions = diffstat.value.diffstat.linesDeleted ?? 0;
  } else if (diffstat.status === 'rejected') {
    const reason: unknown = diffstat.reason;
    console.debug('[gg]', `page_data/diffstat for ${pr.repo.owner}/${pr.repo.name}#${pr.number} failed; the row shows no line counts:`, reason instanceof Error ? reason.message : reason);
  }
  return found;
}

/** A dashboard row ("Pull"), as GitHub's dashboard components receive it. */
export interface Pull {
  id: string;
  itemType?: string;
  number: number;
  title?: string;
  permalink?: string;
  repoNameWithOwner?: string;
  author?: { displayLogin: string } | null;
  state?: string;
  displayState?: string;
  isDraft?: boolean;
  category?: string | null;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string | null;
  closedAt?: string | null;
  isReadByCurrentUser?: boolean | null;
  commentCount?: number;
  labels?: Array<{ name: string; color: string }>;
  stackPosition?: number | null;
  stackSize?: number | null;
  // Deferred fields, present after /deferred.
  reviewDecisionState?: string | null;
  statusCheckRollup?: { state?: string; totalCount: number; successCount: number } | null;
  approvedReviewsCount?: number;
  changesRequestedReviewsCount?: number;
}
