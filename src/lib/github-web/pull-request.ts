// The PR page, from GitHub's own page_data JSON routes plus the PR page's HTML (for its embedded layout data
// and the server-rendered conversation, whose JSON route stops after 25 items). Who is signed in comes from that
// HTML; the routes behind the sidebar cards are side details the page renders without.

import type { PrDetail, PrSummary, RepoRef, UserRef } from '../model';
import type { MergeMethod } from '../rpc';
import { changedFiles, type BaseComparison } from './files';
import { deferredFields, searchPulls, summarisePull } from './inbox';
import { mergeState } from './merge-box';
import { checksFrom } from './checks';
import { reviewDecisionOf, reviewersOf } from './reviews';
import { SIGNED_OUT, embeddedPayload, getJson, getPage, githubUser } from './session';
import { resolveStack, type NativeStack } from './stack';
import { reviewThreads } from './threads';
import { timelineFrom } from './timeline';

export async function fetchPullRequestPage(repo: RepoRef, number: number, mergeMethod: MergeMethod): Promise<PrDetail> {
  const path = `/${repo.owner}/${repo.name}/pull/${number}`;
  const pageUrl = `https://github.com${path}`;
  const data = `${path}/page_data`;
  // A side detail that fails (a 404 for a feature the repository lacks, an unexpected shape) is logged and leaves
  // its card empty instead of failing the page.
  const sideDetail = <T,>(route: string): Promise<T | null> =>
    getJson<T>(`${data}/${route}`).catch((error: unknown) => {
      console.debug('[gg]', `page_data/${route.split('?')[0]} failed; showing the page without it:`, error instanceof Error ? error.message : error);
      return null;
    });
  const [page, comparison, tabCounts, diffstat, threadsData, mergeBox, statusChecks, description, reviewRequests, labels, assignees] = await Promise.all([
    getPage(path),
    getJson<BaseComparison>(`${data}/base_comparison_info`).then((info) => ({ ...info, diffSummaries: info.diffSummaries ?? [] })),
    getJson<{ filesChangedCount?: number; conversationCount?: number; unresolvedConversationCount?: number }>(`${data}/tab_counts`),
    getJson<{ diffstat?: { linesAdded?: number; linesDeleted?: number } }>(`${data}/diffstat`),
    getJson<unknown>(`${data}/threads`),
    sideDetail<unknown>(`merge_box?merge_method=${mergeMethod}&bypass_requirements=false`),
    sideDetail<unknown>('status_checks'),
    sideDetail<{ body?: string; bodyHtml?: string }>('description'),
    sideDetail<unknown>('review_requests'),
    sideDetail<{ labels?: Array<{ name: string; color: string }> }>('labels'),
    sideDetail<{ assignees?: Array<{ login?: string; displayLogin?: string; avatarUrl?: string }> }>('assignees'),
  ]);

  // Signed out, GitHub still serves a public PR's page (and the routes above but the session-only ones) with an empty `user-login`.
  const viewerLogin = page.querySelector('meta[name="user-login"]')?.getAttribute('content');
  if (!viewerLogin) throw new Error(SIGNED_OUT);
  const layout = embeddedPayload(page, 'pullRequestsLayoutRoute')?.payload.pullRequestsLayoutRoute as LayoutRoute | undefined;
  if (!layout?.pullRequest) throw new Error(`GitHub's page for ${repo.owner}/${repo.name}#${number} carries no pull request data`);
  const pr = layout.pullRequest;
  const author = githubUser(pr.author?.login ?? 'ghost', pr.author?.avatarUrl);
  const isDraft = pr.state === 'DRAFT';
  const state = pr.state === 'MERGED' || pr.state === 'CLOSED' ? pr.state : 'OPEN';
  const nativeStack = layout.stack?.pulls?.length ? layout.stack : null;

  const { threads, threadIdsByReview } = reviewThreads(threadsData, comparison, page);
  const timeline = timelineFrom(page, {
    pageUrl,
    threadIdsByReview,
    commits: new Map(
      (comparison.commits ?? []).flatMap((commit) => {
        const createdAt = Date.parse(commit.createdAt);
        return Number.isNaN(createdAt) ? [] : [[commit.oid, { createdAt: new Date(createdAt).toISOString(), actorLogin: commit.actorLogin ?? null }] as const];
      }),
    ),
  });
  const { ci, requiredCheckNames } = checksFrom(statusChecks);
  const merge = mergeState(mergeBox, { isDraft, isOpen: state === 'OPEN' });
  const reviewers = reviewersOf({ requests: reviewRequests, latestOpinionatedReviews: merge.latestOpinionatedReviews, timeline, author: author.login });
  // The page has no "updated" time; the latest thing that happened is the closest equivalent.
  const times = [pr.createdTime, pr.closedTime, pr.mergedTime, ...timeline.map((item) => (item.kind === 'commit' ? item.committedAt : item.createdAt))];
  const updatedAt = times.filter((time): time is string => !!time).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? pr.createdTime;

  const summary: PrSummary = {
    id: pr.relayId,
    repo,
    number,
    title: pr.title,
    url: pageUrl,
    author,
    state,
    isDraft,
    createdAt: pr.createdTime,
    updatedAt,
    mergedAt: pr.mergedTime ?? null,
    headRefName: pr.headBranch,
    baseRefName: pr.baseBranch,
    reviewDecision: reviewDecisionOf(reviewers, merge.numReviewsRequired),
    reviewers,
    ci,
    mergeStatus: merge.mergeStatus,
    additions: diffstat.diffstat?.linesAdded ?? 0,
    deletions: diffstat.diffstat?.linesDeleted ?? 0,
    changedFiles: tabCounts.filesChangedCount ?? comparison.diffSummaries.length,
    labels: (labels?.labels ?? []).map((label) => ({ name: label.name, color: label.color })),
    commentCount: tabCounts.conversationCount ?? 0,
    unread: null,
    isInMergeQueue: merge.isInMergeQueue,
    autoMerge: merge.autoMerge,
    nativeStack: nativeStack && { position: nativeStack.position, size: nativeStack.size },
  };

  const [files, stack] = await Promise.all([
    changedFiles(path, repo, comparison),
    resolveStack(
      { current: summary, nativeStack, page },
      {
        mergeability: () => sideDetail<unknown>(`stack_mergeability?merge_method=${mergeMethod}&bypass_requirements=false`),
        authorsOpenPulls: async () => {
          const query = `repo:${repo.owner}/${repo.name} is:pr is:open author:${author.login}`;
          try {
            const { pulls } = await searchPulls(query);
            const deferred = await deferredFields(pulls, { query });
            return pulls.map((pull) => summarisePull({ ...pull, ...deferred.get(pull.id) }, null));
          } catch (error) {
            console.debug('[gg]', "the author's open PRs failed; showing the stack from Graphite's comment alone:", error instanceof Error ? error.message : error);
            return [];
          }
        },
      },
    ),
  ]);

  return {
    ...summary,
    // Without page_data/description, the description as the conversation renders it.
    bodyHtml: description?.bodyHtml ?? page.querySelector('[id^="pullrequest-"] .comment-body')?.innerHTML.trim() ?? '',
    body: description?.body ?? '',
    headOid: pr.headSha,
    baseOid: comparison.comparison?.fullDiff?.baseOid ?? '',
    assignees: (assignees?.assignees ?? []).flatMap((assignee): UserRef[] => {
      const login = assignee.login ?? assignee.displayLogin;
      return login ? [githubUser(login, assignee.avatarUrl)] : [];
    }),
    viewerCanUpdate: layout.user?.canEditTitle ?? false,
    viewerDidAuthor: viewerLogin === author.login,
    viewerLogin,
    timeline,
    threads,
    files,
    stack,
    defaultMergeMethod: merge.defaultMergeMethod ?? layout.mergeStatusButtonData?.defaultMergeMethod ?? 'MERGE',
    allowedMergeMethods: merge.allowedMergeMethods,
    viewerCanMerge: merge.viewerCanMerge,
    viewerCanEnableAutoMerge: merge.viewerCanEnableAutoMerge,
    requiredCheckNames,
    unresolvedThreadCount: tabCounts.unresolvedConversationCount ?? threads.filter((thread) => !thread.isResolved).length,
  };
}

/** `payload.pullRequestsLayoutRoute` of the PR page (observed; the fields read here). */
interface LayoutRoute {
  pullRequest: {
    /** Database id. */
    id: number;
    relayId: string;
    number: number;
    title: string;
    state: 'OPEN' | 'DRAFT' | 'MERGED' | 'CLOSED';
    author: { login: string; avatarUrl?: string } | null;
    baseBranch: string;
    headBranch: string;
    headSha: string;
    createdTime: string;
    closedTime?: string | null;
    mergedTime?: string | null;
  };
  stack?: NativeStack | null;
  mergeStatusButtonData?: { defaultMergeMethod?: MergeMethod } | null;
  user?: { canEditTitle?: boolean } | null;
}
