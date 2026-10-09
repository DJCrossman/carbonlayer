// The PR page: one GraphQL request for the PR itself, REST for the per-file patches, then the stack.

import type { ChangedFile, PrDetail, PrSummary, RepoRef, ReviewThread, Stack, TimelineItem, UserRef } from '../model';
import { graphql, rest } from './client';
import { summarisePullRequest } from './inbox';
import { GHOST, PULL_REQUEST_PAGE, VIEWED_FILES, type PullRequestCard } from './queries';
import { githubStackLookups, resolveStack } from './stack';

export async function fetchPullRequest(token: string, repo: RepoRef, number: number): Promise<PrDetail> {
  const variables = { owner: repo.owner, name: repo.name, number };
  const [page, files] = await Promise.all([graphql<PullRequestPage>(token, PULL_REQUEST_PAGE, variables), changedFiles(token, repo, number)]);
  const repository = page.repository;
  const pr = repository?.pullRequest;
  if (!repository || !pr) {
    throw new Error(
      `Could not load ${repo.owner}/${repo.name}#${number}: it does not exist or the token cannot see it (for SSO organisations, authorise the token for the organisation).`,
    );
  }

  const summary = summarisePullRequest(pr);
  const subject = {
    summary,
    defaultBranch: repository.defaultBranchRef?.name ?? summary.baseRefName,
    isCrossRepository: pr.isCrossRepository,
    texts: [pr.body, ...pr.timelineItems.nodes.flatMap((item) => (item?.__typename === 'IssueComment' ? [item.body] : []))],
  };
  const [viewedStates, stack] = await Promise.all([
    viewedStatesOf(token, variables, pr.files),
    // The stack is a nicety: a failed lookup must not take the PR page down with it.
    resolveStack(subject, githubStackLookups(token, repo, number)).catch((error: unknown): Stack => {
      console.warn('[github] stack lookup failed', error);
      return { entries: [summary], currentIndex: 0, trunk: summary.baseRefName, source: 'none' };
    }),
  ]);
  return pullRequestDetail({ viewerLogin: page.viewer.login, repository, pr, summary, files, viewedStates, stack });
}

/** The PR page model from the GraphQL page, the REST file list and the resolved stack. */
export function pullRequestDetail(input: {
  viewerLogin: string;
  repository: PageRepository;
  pr: PagePullRequest;
  summary: PrSummary;
  files: RestFile[];
  viewedStates: Map<string, ChangedFile['viewerViewedState']>;
  stack: Stack;
}): PrDetail {
  const { repository, pr, summary } = input;
  const threads = threadsOf(pr);
  const mergeMethodAllowed = { MERGE: repository.mergeCommitAllowed, SQUASH: repository.squashMergeAllowed, REBASE: repository.rebaseMergeAllowed };
  return {
    ...summary,
    bodyHtml: pr.bodyHTML,
    body: pr.body,
    headOid: pr.headRefOid,
    baseOid: pr.baseRefOid,
    assignees: pr.assignees.nodes.flatMap((assignee) => (assignee ? [assignee] : [])),
    viewerCanUpdate: pr.viewerCanUpdate,
    viewerDidAuthor: pr.viewerDidAuthor,
    viewerLogin: input.viewerLogin,
    timeline: timelineOf(pr),
    threads,
    files: input.files.map((file) => ({
      path: file.filename,
      previousPath: file.previous_filename ?? null,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch ?? null,
      viewerViewedState: input.viewedStates.get(file.filename) ?? 'UNVIEWED',
      blobUrl: file.blob_url,
    })),
    stack: input.stack,
    defaultMergeMethod: repository.viewerDefaultMergeMethod,
    allowedMergeMethods: (['MERGE', 'SQUASH', 'REBASE'] as const).filter((method) => mergeMethodAllowed[method]),
    viewerCanMerge: pr.state === 'OPEN' && ['WRITE', 'MAINTAIN', 'ADMIN'].includes(repository.viewerPermission ?? ''),
    viewerCanEnableAutoMerge: pr.viewerCanEnableAutoMerge,
    requiredCheckNames: (pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []).flatMap((context) =>
      context?.isRequired ? [context.__typename === 'CheckRun' ? context.name : context.context] : [],
    ),
    unresolvedThreadCount: threads.filter((thread) => !thread.isResolved).length,
  };
}

/** The changed files with their patches, following `Link: rel="next"` up to GitHub's 3,000-file cap. */
async function changedFiles(token: string, repo: RepoRef, number: number): Promise<RestFile[]> {
  const files: RestFile[] = [];
  let next: string | null = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/pulls/${number}/files?per_page=100`;
  while (next && files.length < 3000) {
    const page: { body: RestFile[]; link: string | null } = await rest<RestFile[]>(token, next);
    files.push(...page.body);
    next = /<([^>]+)>;\s*rel="next"/.exec(page.link ?? '')?.[1] ?? null;
  }
  return files;
}

/** Which files the viewer has marked as viewed (GraphQL only), paging past the first 100 the PR query returned. */
async function viewedStatesOf(
  token: string,
  variables: { owner: string; name: string; number: number },
  firstPage: PagePullRequest['files'],
): Promise<Map<string, ChangedFile['viewerViewedState']>> {
  const states = new Map<string, ChangedFile['viewerViewedState']>();
  let files = firstPage;
  while (files) {
    for (const file of files.nodes) if (file) states.set(file.path, file.viewerViewedState);
    if (!files.pageInfo.hasNextPage || states.size >= 3000) break;
    const data = await graphql<ViewedFilesResponse>(token, VIEWED_FILES, { ...variables, after: files.pageInfo.endCursor });
    files = data.repository?.pullRequest?.files ?? null;
  }
  return states;
}

function threadsOf(pr: PagePullRequest): ReviewThread[] {
  return pr.reviewThreads.nodes.flatMap((thread) => {
    if (!thread) return [];
    const comments = thread.comments.nodes.flatMap((comment) => (comment ? [comment] : []));
    return [
      {
        id: thread.id,
        path: thread.path,
        line: thread.isOutdated ? null : thread.line,
        startLine: thread.isOutdated ? null : thread.startLine,
        side: thread.diffSide,
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        diffHunk: comments[0]?.diffHunk ?? '',
        comments: comments.map((comment) => ({
          id: comment.id,
          author: comment.author ?? GHOST,
          bodyHtml: comment.bodyHTML,
          body: comment.body,
          createdAt: comment.createdAt,
          url: comment.url,
        })),
      },
    ];
  });
}

/** What happened on the PR, oldest first. A review links to the threads its first comments opened. */
function timelineOf(pr: PagePullRequest): TimelineItem[] {
  const threadIdsByReview = new Map<string, string[]>();
  for (const thread of pr.reviewThreads.nodes) {
    const reviewId = thread?.comments.nodes[0]?.pullRequestReview?.id;
    if (thread && reviewId) threadIdsByReview.set(reviewId, [...(threadIdsByReview.get(reviewId) ?? []), thread.id]);
  }

  return pr.timelineItems.nodes.flatMap((item): TimelineItem[] => {
    switch (item?.__typename) {
      case 'IssueComment':
        return [{ kind: 'comment', id: item.id, author: item.author ?? GHOST, bodyHtml: item.bodyHTML, createdAt: item.createdAt, url: item.url }];
      case 'PullRequestReview':
        return [
          {
            kind: 'review',
            id: item.id,
            author: item.author ?? GHOST,
            state: item.state,
            bodyHtml: item.bodyHTML,
            createdAt: item.submittedAt ?? item.createdAt,
            url: item.url,
            threadIds: threadIdsByReview.get(item.id) ?? [],
          },
        ];
      case 'PullRequestCommit':
        return [
          {
            kind: 'commit',
            id: item.id,
            oid: item.commit.oid,
            abbreviatedOid: item.commit.abbreviatedOid,
            messageHeadline: item.commit.messageHeadline,
            author: item.commit.author?.user ?? null,
            committedAt: item.commit.committedDate,
            url: item.url,
          },
        ];
      case 'HeadRefForcePushedEvent':
        return [
          { kind: 'force-push', id: item.id, actor: item.actor, createdAt: item.createdAt, beforeOid: item.beforeCommit?.oid ?? '', afterOid: item.afterCommit?.oid ?? '' },
        ];
      case 'ReviewRequestedEvent': {
        const reviewer = item.requestedReviewer;
        const requested = reviewer && 'login' in reviewer ? reviewer.login : reviewer && 'slug' in reviewer ? reviewer.slug : null;
        return requested ? [{ kind: 'review-requested', id: item.id, actor: item.actor, requested, createdAt: item.createdAt }] : [];
      }
      case 'ReadyForReviewEvent':
        return [{ kind: 'ready-for-review', id: item.id, actor: item.actor, createdAt: item.createdAt }];
      case 'ConvertToDraftEvent':
        return [{ kind: 'converted-to-draft', id: item.id, actor: item.actor, createdAt: item.createdAt }];
      case 'MergedEvent':
        return [{ kind: 'merged', id: item.id, actor: item.actor, createdAt: item.createdAt }];
      case 'ClosedEvent':
        return [{ kind: 'closed', id: item.id, actor: item.actor, createdAt: item.createdAt }];
      case 'ReopenedEvent':
        return [{ kind: 'reopened', id: item.id, actor: item.actor, createdAt: item.createdAt }];
      default:
        return [];
    }
  });
}

export interface PullRequestPage {
  viewer: { login: string };
  repository: PageRepository | null;
}

export interface PageRepository {
  viewerPermission: 'ADMIN' | 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ' | null;
  viewerDefaultMergeMethod: 'MERGE' | 'SQUASH' | 'REBASE';
  mergeCommitAllowed: boolean;
  squashMergeAllowed: boolean;
  rebaseMergeAllowed: boolean;
  defaultBranchRef: { name: string } | null;
  pullRequest: PagePullRequest | null;
}

export interface PagePullRequest extends PullRequestCard {
  body: string;
  bodyHTML: string;
  headRefOid: string;
  baseRefOid: string;
  isCrossRepository: boolean;
  viewerCanUpdate: boolean;
  viewerDidAuthor: boolean;
  viewerCanEnableAutoMerge: boolean;
  assignees: { nodes: Array<UserRef | null> };
  files: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{ path: string; viewerViewedState: ChangedFile['viewerViewedState'] } | null>;
  } | null;
  reviewThreads: {
    nodes: Array<{
      id: string;
      isResolved: boolean;
      isOutdated: boolean;
      path: string;
      line: number | null;
      startLine: number | null;
      diffSide: 'LEFT' | 'RIGHT';
      comments: {
        nodes: Array<{
          id: string;
          author: UserRef | null;
          body: string;
          bodyHTML: string;
          createdAt: string;
          url: string;
          diffHunk: string;
          pullRequestReview: { id: string } | null;
        } | null>;
      };
    } | null>;
  };
  timelineItems: { nodes: Array<PageTimelineItem | null> };
}

type PageTimelineItem =
  | { __typename: 'IssueComment'; id: string; author: UserRef | null; body: string; bodyHTML: string; createdAt: string; url: string }
  | {
      __typename: 'PullRequestReview';
      id: string;
      state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
      bodyHTML: string;
      submittedAt: string | null;
      createdAt: string;
      url: string;
      author: UserRef | null;
    }
  | {
      __typename: 'PullRequestCommit';
      id: string;
      url: string;
      commit: { oid: string; abbreviatedOid: string; messageHeadline: string; committedDate: string; author: { user: UserRef | null } | null };
    }
  | {
      __typename: 'HeadRefForcePushedEvent';
      id: string;
      createdAt: string;
      actor: UserRef | null;
      beforeCommit: { oid: string } | null;
      afterCommit: { oid: string } | null;
    }
  | {
      __typename: 'ReviewRequestedEvent';
      id: string;
      createdAt: string;
      actor: UserRef | null;
      requestedReviewer: { __typename: string; login?: string; slug?: string } | null;
    }
  | {
      __typename: 'ReadyForReviewEvent' | 'ConvertToDraftEvent' | 'MergedEvent' | 'ClosedEvent' | 'ReopenedEvent';
      id: string;
      createdAt: string;
      actor: UserRef | null;
    };

export interface RestFile {
  filename: string;
  previous_filename?: string;
  status: ChangedFile['status'];
  additions: number;
  deletions: number;
  patch?: string;
  blob_url: string;
}

interface ViewedFilesResponse {
  repository: { pullRequest: { files: PagePullRequest['files'] } | null } | null;
}
