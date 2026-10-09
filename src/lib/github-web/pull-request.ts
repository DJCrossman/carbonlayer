// The PR page, from GitHub's own page_data JSON routes plus the PR page's HTML (for its embedded layout data
// and the server-rendered conversation, whose JSON route stops after 25 items).

import type { PrDetail, PrSummary, RepoRef, UserRef } from '../model';
import type { MergeMethod } from '../rpc';
import { changedFiles, type BaseComparison } from './files';
import { deferredFields, searchPulls, summarisePull } from './inbox';
import { mergeState } from './merge-box';
import { checksFrom } from './checks';
import { reviewDecisionOf, reviewersOf } from './reviews';
import { embeddedPayload, getJson, getPage, githubUser } from './session';
import { resolveStack, type NativeStack } from './stack';
import { reviewThreads } from './threads';
import { timelineFrom } from './timeline';

export async function fetchPullRequestPage(repo: RepoRef, number: number, mergeMethod: MergeMethod): Promise<PrDetail> {
  const path = `/${repo.owner}/${repo.name}/pull/${number}`;
  const pageUrl = `https://github.com${path}`;
  const data = `${path}/page_data`;
  const [page, comparison, tabCounts, diffstat, mergeBox, statusChecks, threadsData, description, reviewRequests, labels, assignees] = await Promise.all([
    getPage(path),
    getJson<BaseComparison>(`${data}/base_comparison_info`),
    getJson<{ filesChangedCount?: number; conversationCount?: number; unresolvedConversationCount?: number }>(`${data}/tab_counts`),
    getJson<{ diffstat?: { linesAdded?: number; linesDeleted?: number } }>(`${data}/diffstat`),
    getJson<unknown>(`${data}/merge_box?merge_method=${mergeMethod}&bypass_requirements=false`),
    getJson<unknown>(`${data}/status_checks`),
    getJson<unknown>(`${data}/threads`),
    getJson<{ body?: string; bodyHtml?: string }>(`${data}/description`),
    // Side details: the page still renders without them.
    getJson<unknown>(`${data}/review_requests`).catch(() => null),
    getJson<{ labels?: Array<{ name: string; color: string }> }>(`${data}/labels`).catch(() => null),
    getJson<{ assignees?: Array<{ login?: string; displayLogin?: string; avatarUrl?: string }> }>(`${data}/assignees`).catch(() => null),
  ]);

  const layout = embeddedPayload(page, 'pullRequestsLayoutRoute')?.payload.pullRequestsLayoutRoute as LayoutRoute | undefined;
  if (!layout?.pullRequest) throw new Error(`GitHub's page for ${repo.owner}/${repo.name}#${number} carries no pull request data`);
  const pr = layout.pullRequest;
  const author = githubUser(pr.author?.login ?? 'ghost', pr.author?.avatarUrl);
  const isDraft = pr.state === 'DRAFT';
  const state = pr.state === 'MERGED' || pr.state === 'CLOSED' ? pr.state : 'OPEN';
  const viewerLogin = page.querySelector('meta[name="user-login"]')?.getAttribute('content') || comparison.user?.currentUserLogin || layout.mergeStatusButtonData?.viewerLogin || '';

  const { threads, threadIdsByReview } = reviewThreads(threadsData, comparison, page);
  const timeline = timelineFrom(page, {
    pageUrl,
    threadIdsByReview,
    commits: new Map((comparison.commits ?? []).map((commit) => [commit.oid, { createdAt: new Date(commit.createdAt).toISOString(), actorLogin: commit.actorLogin ?? null }])),
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
    nativeStack: layout.stack ? { position: layout.stack.position, size: layout.stack.size } : null,
  };

  const [files, stack] = await Promise.all([
    changedFiles(path, repo, comparison),
    resolveStack(
      { current: summary, nativeStack: layout.stack ?? null, page },
      {
        mergeability: () => getJson<unknown>(`${data}/stack_mergeability?merge_method=${mergeMethod}&bypass_requirements=false`),
        authorsOpenPulls: async () => {
          const query = `repo:${repo.owner}/${repo.name} is:pr is:open author:${author.login}`;
          const { pulls } = await searchPulls(query);
          const deferred = await deferredFields(pulls, { query });
          return pulls.map((pull) => summarisePull({ ...pull, ...deferred.get(pull.id) }, null));
        },
      },
    ),
  ]);

  return {
    ...summary,
    bodyHtml: description.bodyHtml ?? '',
    body: description.body ?? '',
    headOid: pr.headSha,
    baseOid: comparison.comparison?.fullDiff?.baseOid ?? '',
    assignees: (assignees?.assignees ?? []).flatMap((assignee): UserRef[] => {
      const login = assignee.login ?? assignee.displayLogin;
      return login ? [githubUser(login, assignee.avatarUrl)] : [];
    }),
    viewerCanUpdate: layout.user?.canEditTitle ?? false,
    viewerDidAuthor: viewerLogin !== '' && viewerLogin === author.login,
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
  mergeStatusButtonData?: { defaultMergeMethod?: MergeMethod; viewerLogin?: string } | null;
  user?: { canEditTitle?: boolean } | null;
}
