// The inbox. Each view is one of GitHub's own inbox sections (`inbox:<filter>` → /pulls/inbox/queries) or a
// search (/pulls/search); the rows shown then get their "deferred" fields (review decision, CI rollup), and the rows on
// screen later what the dashboard has not at all (mergeability, reviewers, line counts, failing checks) from each PR's
// page data.

import { z } from 'zod';
import type { CheckState, PrEnrichment, PrSummary, RepoRef, StackBranches, View, ViewResult } from '../model';
import type { InboxRowToEnrich, MergeMethod } from '../rpc';
import { inboxFilterOf, resolveViewQuery, type GitHubInboxFilter } from '../views';
import { dynamicWorkflowChecks } from './actions';
import { checksFrom, statusChecksAnswer } from './checks';
import { mergeBoxAnswer, mergeState, type MergeBoxAnswer } from './merge-box';
import { reviewDecisionOf, reviewRequestsAnswer, reviewersOf } from './reviews';
import { SIGNED_OUT, embeddedPayload, findInPayload, getJson, githubUser, politely, readAnswer, request } from './session';
import { conversationsIn, threadsAnswer } from './threads';

/**
 * Every view's first page of rows, cut to its limit, three views at a time so at most three requests are in flight. A
 * view GitHub would not search, or whose request failed, comes back without rows, saying why and what GitHub was asked,
 * and the others load as ever; signed out, none can, and the whole inbox says so.
 */
export async function fetchInbox(views: View[], scope: string): Promise<ViewResult[]> {
  return politely(views, 3, async (view) => {
    const query = resolveViewQuery(view, scope);
    try {
      return await fetchView(view, query, 1, view.limit ?? 50);
    } catch (error) {
      if (error instanceof Error && error.message === SIGNED_OUT) throw error;
      return { view, prs: [], totalCount: 0, fetchedAt: new Date().toISOString(), error: { message: error instanceof Error ? error.message : String(error), query } };
    }
  });
}

/** Page `page` of a view's rows, the way GitHub pages its search or section, whole: what "Load more" adds to a section. */
export function fetchViewPage(view: View, scope: string, page: number): Promise<ViewResult> {
  return fetchView(view, resolveViewQuery(view, scope), page, Infinity);
}

async function fetchView(view: View, query: string, page: number, limit: number): Promise<ViewResult> {
  const section = inboxFilterOf(view);
  let found: { pulls: Pull[]; totalCount: number };
  if (section) {
    found = pullsIn(await getJson(`/pulls/inbox/queries?filter=${section}&max_pr_age=1m${page > 1 ? `&page=${page}` : ''}`, sectionAnswer));
  } else {
    found = await searchPulls(query, page);
  }
  const shown = found.pulls.slice(0, limit);
  const deferred = await deferredFields(shown, section ? { section } : { query }, page);
  return {
    view,
    prs: shown.map((pull) => summarisePull({ ...pull, ...deferred.get(pull.id) }, section)),
    totalCount: found.totalCount,
    fetchedAt: new Date().toISOString(),
  };
}

/** The pull requests among a section's or search's rows (`{ results, totalCount | pageInfo }` or `{ pulls }`), and their total. */
function pullsIn(answer: PullsPage): { pulls: Pull[]; totalCount: number } {
  const pulls = (answer.results ?? answer.pulls ?? []).filter((pull) => pull.itemType == null || pull.itemType === 'pull_request');
  return { pulls, totalCount: answer.totalCount ?? answer.pageInfo?.totalCount ?? pulls.length };
}

/**
 * A page of a search's rows (the first unless said), the way GitHub's dashboard renders it. Also used for stack
 * neighbours. A search GitHub will not run throws GitHub's reason.
 */
export async function searchPulls(query: string, page = 1): Promise<{ pulls: Pull[]; totalCount: number }> {
  const response = await request(`/pulls/search?${new URLSearchParams({ q: query, ...(page > 1 && { page: String(page) }) })}`, 'application/json');
  // Answered with JSON, the route's data comes in GitHub's `{ payload: { <route>: … } }`, the envelope its deferred fields
  // come in; answered with a page, it is embedded there. A page without it has no rows.
  const found = response.headers.get('content-type')?.includes('json')
    ? readAnswer('/pulls/search', searchAnswer, await response.json()).payload.pullsDashboardSurfaceContentRoute
    : embeddedPayload(new DOMParser().parseFromString(await response.text(), 'text/html'), 'pullsDashboardSurfaceContentRoute', searchRoute);
  // GitHub answers a search it will not run with a 200, no rows and why: "The search query contains invalid syntax.", or
  // that a date is not one it can read.
  if (found?.error) throw new Error(found.error);
  return found ? pullsIn(found) : { pulls: [], totalCount: 0 };
}

/**
 * The deferred fields (review decision, CI rollup, review counts) of these rows, by PR id. The rows still show without
 * them, so a failure is logged and yields none.
 */
export async function deferredFields(pulls: Pull[], search: { section: GitHubInboxFilter } | { query: string }, page = 1): Promise<Map<string, DeferredRow>> {
  if (pulls.length === 0) return new Map();
  const params = new URLSearchParams('section' in search ? { page: String(page) } : { q: search.query, page: String(page) });
  for (const pull of pulls) params.append('ids[]', pull.id);
  // A search answers `{ meta, payload: { pullsDashboardSurfaceContentDeferredData: { results: { "0": row, … } } } }` (an
  // object keyed by index, not an array; verified). Where a section's answer puts its rows has not been seen: they are
  // looked for wherever GitHub nests them, as the first list or object holding one with a PR's relay id.
  let rows: DeferredRow[];
  try {
    if ('section' in search) {
      const answer = await getJson(`/pulls/inbox/deferred?${params}`, z.unknown());
      const holdsRows = (value: unknown) => typeof value === 'object' && value !== null && Object.values(value).some((row) => z.object({ id: z.string() }).safeParse(row).success);
      const found = holdsRows(answer) ? answer : findInPayload(answer, (_, value) => holdsRows(value));
      rows = readAnswer('/pulls/inbox/deferred', z.array(deferredRowSchema), typeof found === 'object' && found !== null ? Object.values(found) : []);
    } else {
      const answer = await getJson(`/pulls/deferred?${params}`, searchDeferredAnswer);
      rows = Object.values(answer.payload.pullsDashboardSurfaceContentDeferredData.results);
    }
  } catch (error) {
    console.debug('[gg]', 'deferred fields failed; showing the rows without review and CI status:', error instanceof Error ? error.message : error);
    return new Map();
  }
  return new Map(rows.map((row) => [row.id, row]));
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
    mergeStatus: pull.category === 'READY_TO_MERGE' || section === 'ready-to-merge' ? 'CLEAN' : 'UNKNOWN',
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
    // Not in the dashboard data: the row's own threads say, once it is enriched.
    conversations: null,
  };
}

/**
 * What GitHub's dashboard leaves out of a row, from the PR's own page data: mergeability, and why merging is blocked,
 * from its merge box (`page_data/merge_box`, read as the PR page reads it); reviewers, and the viewer's own review,
 * from `page_data/review_requests`, else from what the merge box names (`latestOpinionatedReviews`, pending requests),
 * and the verdict they make as the PR page words it (`reviewDecisionOf`, with the approvals the merge box requires); line
 * counts from `page_data/diffstat`; its conversations, resolved of all, from `page_data/threads`; and for an open
 * PR, the checks themselves (which fail, which are required, and whether anything but Graphite's mergeability check is
 * still running) from `page_data/status_checks`, with GitHub's own dynamic workflow runs on the head commit, which only
 * the branch's Actions list names. A merged or closed PR's merge status is its state, so it does not ask the merge box;
 * a draft does, and shows how it would merge. A route that fails is logged and leaves its fields out: the row keeps
 * what it had. The merge box also names the branches, which chain the inbox's stacks (a fork's head branch left out).
 */
export async function enrichPull(pr: InboxRowToEnrich, mergeMethod: MergeMethod, viewerLogin: string | null): Promise<PrEnrichment> {
  const data = `/${pr.repo.owner}/${pr.repo.name}/pull/${pr.number}/page_data`;
  const asksMergeBox = pr.state === 'OPEN';
  // A failing rollup needs its checks to tell required failures from optional ones; a pending one may be pending only on
  // Graphite's mergeability check, which the checks leave out; a passed one may hide a failed run of GitHub's own dynamic
  // workflows (Copilot's review), which Graphite counts.
  const asksChecks = pr.state === 'OPEN';
  const [mergeBox, diffstat, reviewRequests, statusChecks, threads] = await Promise.allSettled([
    asksMergeBox ? getJson(`${data}/merge_box?merge_method=${mergeMethod}&bypass_requirements=false`, mergeBoxAnswer) : null,
    getJson(`${data}/diffstat`, z.object({ diffstat: z.object({ linesAdded: z.number().nullish(), linesDeleted: z.number().nullish() }).nullish() })),
    getJson(`${data}/review_requests`, reviewRequestsAnswer),
    asksChecks ? getJson(`${data}/status_checks`, statusChecksAnswer) : null,
    getJson(`${data}/threads`, threadsAnswer),
  ]);
  const where = `${pr.repo.owner}/${pr.repo.name}#${pr.number}`;
  const found: PrEnrichment = {};
  let named: Pick<NonNullable<MergeBoxAnswer['pullRequest']>, 'latestOpinionatedReviews' | 'pendingReviewRequests'> | null = null;
  let numReviewsRequired = 0;
  if (asksMergeBox && mergeBox.status === 'fulfilled') {
    const merge = mergeState(mergeBox.value, { isDraft: pr.isDraft, isOpen: true });
    found.mergeStatus = merge.mergeStatus;
    numReviewsRequired = merge.numReviewsRequired;
    // The first requirement the merge box says is unmet, e.g. "At least 1 approving review is required".
    const unmet = (mergeBox.value?.mergeRequirements?.conditions ?? []).find((condition) => condition.result === 'FAILED');
    const reason = unmet?.message || unmet?.description || unmet?.displayName;
    if (reason && (merge.mergeStatus === 'BLOCKED' || merge.mergeStatus === 'BEHIND' || merge.mergeStatus === 'UNSTABLE')) found.mergeBlockedReason = reason;
    const pendingReviewRequests = mergeBox.value?.pullRequest?.pendingReviewRequests;
    if (merge.latestOpinionatedReviews != null || pendingReviewRequests !== undefined) named = { latestOpinionatedReviews: merge.latestOpinionatedReviews, pendingReviewRequests };
    // A fork's head branch says nothing about this repository's stacks.
    const branches = mergeBox.value?.pullRequest;
    if (branches?.baseRefName) found.baseRefName = branches.baseRefName;
    if (branches?.headRefName && branches.isCrossRepo !== true) found.headRefName = branches.headRefName;
  } else if (mergeBox.status === 'rejected') {
    const reason: unknown = mergeBox.reason;
    console.debug('[gg]', `page_data/merge_box for ${where} failed; the row keeps its merge status:`, reason instanceof Error ? reason.message : reason);
  }

  // Signed out, review_requests is `{}`: it names nobody.
  const requests = reviewRequests.status === 'fulfilled' && (reviewRequests.value.pendingReviewRequests || reviewRequests.value.completedReviews) ? reviewRequests.value : null;
  if (reviewRequests.status === 'rejected') {
    const reason: unknown = reviewRequests.reason;
    console.debug('[gg]', `page_data/review_requests for ${where} failed; the row names the reviewers its merge box does:`, reason instanceof Error ? reason.message : reason);
  }
  if (requests || named) {
    // The dashboard has no timeline to add commenters from.
    found.reviewers = reviewersOf({
      requests: requests ?? { pendingReviewRequests: named?.pendingReviewRequests },
      latestOpinionatedReviews: named?.latestOpinionatedReviews ?? null,
      timeline: [],
      author: pr.author?.login ?? '',
    });
    found.reviewDecision = reviewDecisionOf(found.reviewers, numReviewsRequired);
    if (viewerLogin) found.viewerReview = found.reviewers.find((reviewer) => reviewer.user.login.toLowerCase() === viewerLogin.toLowerCase())?.state ?? null;
  }

  if (diffstat.status === 'fulfilled' && diffstat.value.diffstat) {
    found.additions = diffstat.value.diffstat.linesAdded ?? 0;
    found.deletions = diffstat.value.diffstat.linesDeleted ?? 0;
  } else if (diffstat.status === 'rejected') {
    const reason: unknown = diffstat.reason;
    console.debug('[gg]', `page_data/diffstat for ${where} failed; the row shows no line counts:`, reason instanceof Error ? reason.message : reason);
  }

  if (threads.status === 'fulfilled') {
    found.conversations = conversationsIn(threads.value);
  } else {
    const reason: unknown = threads.reason;
    console.debug('[gg]', `page_data/threads for ${where} failed; the row shows no conversations:`, reason instanceof Error ? reason.message : reason);
  }

  if (asksChecks && statusChecks.status === 'fulfilled') {
    // The merge box names the head branch and commit, by which the Actions list finds GitHub's own dynamic workflow runs.
    const head = mergeBox.status === 'fulfilled' ? mergeBox.value?.pullRequest : null;
    const dynamicChecks = head?.headRefName && head.headRefOid ? await dynamicWorkflowChecks(pr.repo, head.headRefName, head.headRefOid) : [];
    const { ci, requiredCheckNames, marksRequired, listed } = checksFrom(statusChecks.value, dynamicChecks);
    if (listed) found.ci = ci;
    if (listed && marksRequired) found.requiredCheckNames = requiredCheckNames;
  } else if (statusChecks.status === 'rejected') {
    const reason: unknown = statusChecks.reason;
    console.debug('[gg]', `page_data/status_checks for ${where} failed; the row keeps its rollup:`, reason instanceof Error ? reason.message : reason);
  }
  return found;
}

/**
 * The branches a PR's page header (`page_data/header`) names, by which "Group by stack" chains the inbox's rows before
 * they are enriched: `pullRequest.baseBranch` and `headBranch`, the head only when its repository is `repo` (a fork's
 * head branch says nothing about this repository's stacks). Null when the header names no base branch.
 */
export function branchesIn(header: BranchesHeaderAnswer, repo: RepoRef): StackBranches | null {
  const pull = header.pullRequest;
  if (!pull?.baseBranch) return null;
  const sameRepository =
    pull.headRepositoryOwnerLogin?.toLowerCase() === repo.owner.toLowerCase() && pull.headRepositoryName?.toLowerCase() === repo.name.toLowerCase();
  return { baseRefName: pull.baseBranch, headRefName: sameRepository && pull.headBranch ? pull.headBranch : null };
}

/** A dashboard row ("Pull"), the fields the inbox reads, from GitHub's dashboard components' props. */
const pullSchema = z.object({
  id: z.string(),
  itemType: z.string().nullish(),
  number: z.number(),
  title: z.string().nullish(),
  permalink: z.string().nullish(),
  repoNameWithOwner: z.string().nullish(),
  author: z.object({ displayLogin: z.string() }).nullish(),
  state: z.string().nullish(),
  displayState: z.string().nullish(),
  isDraft: z.boolean().nullish(),
  category: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
  mergedAt: z.string().nullish(),
  closedAt: z.string().nullish(),
  isReadByCurrentUser: z.boolean().nullish(),
  commentCount: z.number().nullish(),
  labels: z.array(z.object({ name: z.string(), color: z.string() })).nullish(),
  stackPosition: z.number().nullish(),
  stackSize: z.number().nullish(),
  // Deferred fields, present after /deferred.
  reviewDecisionState: z.string().nullish(),
  statusCheckRollup: z.object({ state: z.string().nullish(), totalCount: z.number(), successCount: z.number() }).nullish(),
  approvedReviewsCount: z.number().nullish(),
  changesRequestedReviewsCount: z.number().nullish(),
});

export type Pull = z.infer<typeof pullSchema>;

/** A section's or a search's page of rows (the fields read here). */
const pullsPageSchema = z.object({
  results: z.array(pullSchema).nullish(),
  pulls: z.array(pullSchema).nullish(),
  totalCount: z.number().nullish(),
  pageInfo: z.object({ totalCount: z.number().nullish() }).nullish(),
});

type PullsPage = z.infer<typeof pullsPageSchema>;

/**
 * /pulls/inbox/queries: unconfirmed, expected `{ results, totalCount }` (docs/research/github-web-endpoints.md); a bare
 * list of rows is read as its `results`.
 */
const sectionAnswer = z.preprocess((answer) => (Array.isArray(answer) ? { results: answer } : answer), pullsPageSchema);

/** `pullsDashboardSurfaceContentRoute`, a search's page: its rows, and `error`, why GitHub would not run it (else null). */
const searchRoute = pullsPageSchema.extend({ error: z.string().nullish() });

/** /pulls/search answered with JSON: the route's data in GitHub's `{ payload }`. */
const searchAnswer = z.object({ payload: z.object({ pullsDashboardSurfaceContentRoute: searchRoute }) });

/** A row's deferred fields (review decision, CI rollup, review counts), by its PR's relay id. */
const deferredRowSchema = pullSchema.pick({ id: true, reviewDecisionState: true, statusCheckRollup: true, approvedReviewsCount: true, changesRequestedReviewsCount: true });

type DeferredRow = z.infer<typeof deferredRowSchema>;

/** /pulls/deferred (verified signed in 2026-10-12): rows keyed by index. */
const searchDeferredAnswer = z.object({
  payload: z.object({ pullsDashboardSurfaceContentDeferredData: z.object({ results: z.record(z.string(), deferredRowSchema) }) }),
});

/** page_data/header, for the branches "Group by stack" chains (the fields read here). */
export const branchesHeaderAnswer = z.object({
  pullRequest: z
    .object({
      baseBranch: z.string().nullish(),
      headBranch: z.string().nullish(),
      headRepositoryOwnerLogin: z.string().nullish(),
      headRepositoryName: z.string().nullish(),
    })
    .nullish(),
});

type BranchesHeaderAnswer = z.infer<typeof branchesHeaderAnswer>;
