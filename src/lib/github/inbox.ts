// The inbox: every view is one GitHub search, all of them aliased into a single GraphQL request.

import type { PrSummary, ReviewerSummary, View, ViewResult } from '../model';
import { resolveViewQuery } from '../views';
import { ciSummary } from './checks';
import { graphql } from './client';
import { GHOST, inboxQuery, type PullRequestCard } from './queries';

/** Runs the searches from `viewSearches` in one request; results are index-aligned with `searches`. */
export async function searchInbox(token: string, searches: InboxSearch[]): Promise<Array<Omit<ViewResult, 'view'>>> {
  if (searches.length === 0) return [];
  const variables = Object.fromEntries(searches.flatMap(({ query, first }, i) => [[`q${i}`, query], [`first${i}`, first]]));
  const data = await graphql<Record<string, SearchResult | null>>(token, inboxQuery(searches.length), variables);
  const fetchedAt = new Date().toISOString();
  return searches.map((_, i) => {
    const result = data[`v${i}`];
    const prs = (result?.nodes ?? []).flatMap((node) => (node?.__typename === 'PullRequest' ? [summarisePullRequest(node)] : []));
    return { prs, totalCount: result?.issueCount ?? 0, fetchedAt };
  });
}

/**
 * What GitHub is asked for each view: the view query with the global scope and relative dates resolved,
 * limited to PRs, newest activity first unless the view picks its own `sort:`.
 */
export function viewSearches(views: View[], scope: string, now = new Date()): InboxSearch[] {
  return views.map((view) => {
    let query = resolveViewQuery(view, scope, now);
    if (!/(^|\s)(is|type):pr(\s|$)/i.test(query)) query += ' is:pr';
    if (!/(^|\s)sort:/i.test(query)) query += ' sort:updated-desc';
    return { query, first: Math.max(1, Math.min(view.limit ?? 50, 100)) };
  });
}

/** The inbox row / stack entry for a PR: GitHub's fields plus the derived review, CI and merge status. */
export function summarisePullRequest(card: PullRequestCard): PrSummary {
  const author = card.author ?? GHOST;
  return {
    id: card.id,
    repo: { owner: card.repository.owner.login, name: card.repository.name },
    number: card.number,
    title: card.title,
    url: card.url,
    author,
    state: card.state,
    isDraft: card.isDraft,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    mergedAt: card.mergedAt,
    headRefName: card.headRefName,
    baseRefName: card.baseRefName,
    reviewDecision: card.reviewDecision ?? 'NONE',
    reviewers: reviewersOf(card, author.login),
    ci: ciSummary(card.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []),
    mergeStatus: card.isDraft ? 'DRAFT' : (card.mergeStateStatus ?? 'UNKNOWN'),
    additions: card.additions,
    deletions: card.deletions,
    changedFiles: card.changedFiles,
    labels: (card.labels?.nodes ?? []).flatMap((label) => (label ? [{ name: label.name, color: label.color }] : [])),
    commentCount: card.totalCommentsCount ?? 0,
    unread: card.isReadByViewer == null ? null : !card.isReadByViewer,
    isInMergeQueue: card.isInMergeQueue,
    autoMerge: card.autoMergeRequest ? { method: card.autoMergeRequest.mergeMethod } : null,
    nativeStack: card.stack && card.stackEntry ? { position: card.stackEntry.position, size: card.stack.size } : null,
  };
}

/**
 * Who is reviewing and where they stand: requested reviewers start PENDING, a writer's latest approval or
 * change request replaces that, and anyone else whose latest review only commented (or was dismissed) is appended.
 * The author never reviews their own PR.
 */
function reviewersOf(card: PullRequestCard, authorLogin: string): ReviewerSummary[] {
  const byLogin = new Map<string, ReviewerSummary>();
  for (const request of card.reviewRequests?.nodes ?? []) {
    const reviewer = request?.requestedReviewer;
    if (reviewer?.__typename === 'Team') {
      const login = reviewer.combinedSlug ?? reviewer.slug;
      byLogin.set(login, { kind: 'team', user: { login, avatarUrl: '', url: reviewer.url }, state: 'PENDING' });
    } else if (reviewer && 'login' in reviewer) {
      byLogin.set(reviewer.login, { kind: 'user', user: { login: reviewer.login, avatarUrl: reviewer.avatarUrl, url: reviewer.url }, state: 'PENDING' });
    }
  }
  for (const review of card.latestOpinionatedReviews?.nodes ?? []) {
    if (!review?.author || review.state === 'PENDING') continue;
    byLogin.set(review.author.login, { kind: 'user', user: review.author, state: review.state });
  }
  for (const review of card.latestReviews?.nodes ?? []) {
    if (!review?.author || (review.state !== 'COMMENTED' && review.state !== 'DISMISSED') || byLogin.has(review.author.login)) continue;
    byLogin.set(review.author.login, { kind: 'user', user: review.author, state: review.state });
  }
  byLogin.delete(authorLogin);
  return [...byLogin.values()];
}

export interface InboxSearch {
  query: string;
  first: number;
}

interface SearchResult {
  issueCount: number;
  nodes: Array<(PullRequestCard & { __typename: 'PullRequest' }) | { __typename: 'Issue' } | null>;
}
