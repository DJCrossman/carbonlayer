// GraphQL documents. Based on the queries validated in docs/research/*.graphql.
// The PrCard fragment comes first only because every document below embeds it at import time.

import type { MergeStatus, UserRef } from '../model';

/** Everything an inbox row or a stack entry needs (`PrSummary`). */
export const PR_CARD = /* GraphQL */ `
fragment PrCard on PullRequest {
  id number title url isDraft state isReadByViewer
  createdAt updatedAt mergedAt
  author { login avatarUrl url }
  repository { name owner { login } }
  headRefName baseRefName
  reviewDecision mergeStateStatus
  additions deletions changedFiles
  totalCommentsCount
  isInMergeQueue
  autoMergeRequest { mergeMethod }
  stackEntry { position }
  stack { size }
  labels(first: 10) { nodes { name color } }
  reviewRequests(first: 10) {
    nodes {
      requestedReviewer {
        __typename
        ... on User { login avatarUrl url }
        ... on Team { slug combinedSlug url }
        ... on Bot { login avatarUrl url }
        ... on Mannequin { login avatarUrl url }
      }
    }
  }
  latestOpinionatedReviews(first: 10, writersOnly: true) { nodes { state author { login avatarUrl url } } }
  latestReviews(first: 10) { nodes { state author { login avatarUrl url } } }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun {
                name status conclusion detailsUrl title startedAt completedAt
                checkSuite { app { name } workflowRun { workflow { name } } }
              }
              ... on StatusContext { context state targetUrl description }
            }
          }
        }
      }
    }
  }
}`;

/** One aliased search per view (`v0` … `vN`), variables `$q<i>` / `$first<i>`, in a single request. */
export function inboxQuery(viewCount: number): string {
  const indexes = Array.from({ length: viewCount }, (_, i) => i);
  const variables = indexes.map((i) => `$q${i}: String!, $first${i}: Int!`).join(', ');
  const searches = indexes
    .map((i) => `  v${i}: search(type: ISSUE, query: $q${i}, first: $first${i}) { issueCount nodes { __typename ...PrCard } }`)
    .join('\n');
  return `query Inbox(${variables}) {\n  rateLimit { cost remaining resetAt }\n${searches}\n}\n${PR_CARD}`;
}

/** The PR page: the card plus body, threads, timeline, required checks, viewed files and repo merge settings. */
export const PULL_REQUEST_PAGE = /* GraphQL */ `
query PullRequestPage($owner: String!, $name: String!, $number: Int!) {
  rateLimit { cost remaining resetAt }
  viewer { login }
  repository(owner: $owner, name: $name) {
    viewerPermission viewerDefaultMergeMethod
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    defaultBranchRef { name }
    pullRequest(number: $number) {
      ...PrCard
      body bodyHTML headRefOid baseRefOid isCrossRepository
      viewerCanUpdate viewerDidAuthor viewerCanEnableAutoMerge
      assignees(first: 10) { nodes { login avatarUrl url } }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  ... on CheckRun { isRequired(pullRequestNumber: $number) }
                  ... on StatusContext { isRequired(pullRequestNumber: $number) }
                }
              }
            }
          }
        }
      }
      files(first: 100) { pageInfo { hasNextPage endCursor } nodes { path viewerViewedState } }
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line startLine diffSide
          comments(first: 50) {
            nodes { id author { login avatarUrl url } body bodyHTML createdAt url diffHunk pullRequestReview { id } }
          }
        }
      }
      timelineItems(
        last: 100
        itemTypes: [
          ISSUE_COMMENT, PULL_REQUEST_REVIEW, PULL_REQUEST_COMMIT, HEAD_REF_FORCE_PUSHED_EVENT, REVIEW_REQUESTED_EVENT,
          READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, MERGED_EVENT, CLOSED_EVENT, REOPENED_EVENT
        ]
      ) {
        nodes {
          __typename
          ... on IssueComment { id author { login avatarUrl url } body bodyHTML createdAt url }
          ... on PullRequestReview { id state bodyHTML submittedAt createdAt url author { login avatarUrl url } }
          ... on PullRequestCommit {
            id url
            commit { oid abbreviatedOid messageHeadline committedDate author { user { login avatarUrl url } } }
          }
          ... on HeadRefForcePushedEvent { id createdAt actor { login avatarUrl url } beforeCommit { oid } afterCommit { oid } }
          ... on ReviewRequestedEvent {
            id createdAt actor { login avatarUrl url }
            requestedReviewer { __typename ... on User { login } ... on Bot { login } ... on Mannequin { login } ... on Team { slug } }
          }
          ... on ReadyForReviewEvent { id createdAt actor { login avatarUrl url } }
          ... on ConvertToDraftEvent { id createdAt actor { login avatarUrl url } }
          ... on MergedEvent { id createdAt actor { login avatarUrl url } }
          ... on ClosedEvent { id createdAt actor { login avatarUrl url } }
          ... on ReopenedEvent { id createdAt actor { login avatarUrl url } }
        }
      }
    }
  }
}
${PR_CARD}`;

/** Further pages of the viewer's per-file viewed state (100 per page). */
export const VIEWED_FILES = /* GraphQL */ `
query ViewedFiles($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      files(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { path viewerViewedState } }
    }
  }
}`;

/** A GitHub-native stack, entries in any order (sort by `position`; 1 is closest to trunk). */
export const NATIVE_STACK = /* GraphQL */ `
query NativeStack($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      stack { baseRefName entries(first: 25) { nodes { position pullRequest { ...PrCard } } } }
    }
  }
}
${PR_CARD}`;

/** Stack neighbours by branch: PRs whose head is `$branch` (candidates for the PR below). */
export const PULL_REQUESTS_WITH_HEAD = /* GraphQL */ `
query PullRequestsWithHead($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, states: [OPEN, MERGED], first: 5, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number state updatedAt headRefName baseRefName isCrossRepository }
    }
  }
}`;

/** Stack neighbours by branch: open PRs whose base is `$branch` (candidates for the PR above). */
export const OPEN_PULL_REQUESTS_ONTO = /* GraphQL */ `
query OpenPullRequestsOnto($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(baseRefName: $branch, states: [OPEN], first: 10, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number state updatedAt headRefName baseRefName isCrossRepository }
    }
  }
}`;

/** Several PRs of one repository by number, aliased `p0` … `pN` in the order given. */
export function pullRequestsByNumberQuery(numbers: number[]): string {
  const aliases = numbers.map((number, i) => {
    if (!Number.isInteger(number) || number <= 0) throw new Error(`Not a pull request number: ${number}`);
    return `    p${i}: pullRequest(number: ${number}) { ...PrCard }`;
  });
  return `query PullRequestsByNumber($owner: String!, $name: String!) {\n  repository(owner: $owner, name: $name) {\n${aliases.join('\n')}\n  }\n}\n${PR_CARD}`;
}

export const VIEWER = /* GraphQL */ `query Viewer { viewer { login } }`;

// Mutations. Each selects only `clientMutationId`: callers refetch through the cache instead.

export const ADD_REVIEW = /* GraphQL */ `
mutation AddReview($prId: ID!, $event: PullRequestReviewEvent!, $body: String, $threads: [DraftPullRequestReviewThread]) {
  addPullRequestReview(input: { pullRequestId: $prId, event: $event, body: $body, threads: $threads }) { clientMutationId }
}`;

export const ADD_COMMENT = /* GraphQL */ `
mutation AddComment($subjectId: ID!, $body: String!) {
  addComment(input: { subjectId: $subjectId, body: $body }) { clientMutationId }
}`;

export const MERGE_PULL_REQUEST = /* GraphQL */ `
mutation MergePullRequest($prId: ID!, $method: PullRequestMergeMethod!, $expectedHeadOid: GitObjectID!) {
  mergePullRequest(input: { pullRequestId: $prId, mergeMethod: $method, expectedHeadOid: $expectedHeadOid }) { clientMutationId }
}`;

export const REPLY_TO_THREAD = /* GraphQL */ `
mutation ReplyToThread($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) { clientMutationId }
}`;

export const RESOLVE_THREAD = /* GraphQL */ `
mutation ResolveThread($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { clientMutationId } }`;

export const UNRESOLVE_THREAD = /* GraphQL */ `
mutation UnresolveThread($threadId: ID!) { unresolveReviewThread(input: { threadId: $threadId }) { clientMutationId } }`;

export const MARK_FILE_VIEWED = /* GraphQL */ `
mutation MarkFileViewed($prId: ID!, $path: String!) { markFileAsViewed(input: { pullRequestId: $prId, path: $path }) { clientMutationId } }`;

export const UNMARK_FILE_VIEWED = /* GraphQL */ `
mutation UnmarkFileViewed($prId: ID!, $path: String!) { unmarkFileAsViewed(input: { pullRequestId: $prId, path: $path }) { clientMutationId } }`;

export const MARK_READY_FOR_REVIEW = /* GraphQL */ `
mutation MarkReadyForReview($prId: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $prId }) { clientMutationId } }`;

export const CONVERT_TO_DRAFT = /* GraphQL */ `
mutation ConvertToDraft($prId: ID!) { convertPullRequestToDraft(input: { pullRequestId: $prId }) { clientMutationId } }`;

export const ENABLE_AUTO_MERGE = /* GraphQL */ `
mutation EnableAutoMerge($prId: ID!, $method: PullRequestMergeMethod!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $prId, mergeMethod: $method }) { clientMutationId }
}`;

export const DISABLE_AUTO_MERGE = /* GraphQL */ `
mutation DisableAutoMerge($prId: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $prId }) { clientMutationId } }`;

// Response shapes shared by several documents.

/** A `...PrCard` node. Actors are selected as `{ login avatarUrl url }`, which is exactly a `UserRef`. */
export interface PullRequestCard {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isReadByViewer: boolean | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  author: UserRef | null;
  repository: { name: string; owner: { login: string } };
  headRefName: string;
  baseRefName: string;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  mergeStateStatus: MergeStatus | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  totalCommentsCount: number | null;
  isInMergeQueue: boolean;
  autoMergeRequest: { mergeMethod: 'MERGE' | 'SQUASH' | 'REBASE' } | null;
  stackEntry: { position: number } | null;
  stack: { size: number } | null;
  labels: { nodes: Array<{ name: string; color: string } | null> } | null;
  reviewRequests: { nodes: Array<{ requestedReviewer: RequestedReviewer | null } | null> } | null;
  latestOpinionatedReviews: { nodes: Array<CardReview | null> } | null;
  latestReviews: { nodes: Array<CardReview | null> } | null;
  commits: { nodes: Array<{ commit: { statusCheckRollup: { contexts: { nodes: Array<CheckContext | null> } } | null } } | null> };
}

export type RequestedReviewer =
  | { __typename: 'User' | 'Bot' | 'Mannequin'; login: string; avatarUrl: string; url: string }
  | { __typename: 'Team'; slug: string; combinedSlug: string | null; url: string }
  | { __typename: 'EnterpriseTeam' };

export interface CardReview {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  author: UserRef | null;
}

/** A head-commit status context. `isRequired` is only selected by the PR page query. */
export type CheckContext =
  | {
      __typename: 'CheckRun';
      name: string;
      status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'WAITING' | 'PENDING' | 'REQUESTED';
      conclusion: 'SUCCESS' | 'FAILURE' | 'TIMED_OUT' | 'ACTION_REQUIRED' | 'STARTUP_FAILURE' | 'CANCELLED' | 'SKIPPED' | 'NEUTRAL' | 'STALE' | null;
      detailsUrl: string | null;
      title: string | null;
      startedAt: string | null;
      completedAt: string | null;
      checkSuite: { app: { name: string } | null; workflowRun: { workflow: { name: string } } | null } | null;
      isRequired?: boolean;
    }
  | {
      __typename: 'StatusContext';
      context: string;
      state: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED';
      targetUrl: string | null;
      description: string | null;
      isRequired?: boolean;
    };

/** GitHub's stand-in for an actor whose account was deleted (responses give `null`). */
export const GHOST: UserRef = { login: 'ghost', avatarUrl: '', url: 'https://github.com/ghost' };
