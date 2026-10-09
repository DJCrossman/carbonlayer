// Who reviews the PR and where they stand. Pending requests come from page_data/review_requests
// (`{ pendingReviewRequests: [{ reviewer: { displayLogin, name, avatarUrl, reviewerType } }] }`, observed);
// verdicts from the merge box's `latestOpinionatedReviews` when present, else from the reviews in the timeline.

import type { ReviewDecision, ReviewerSummary, TimelineItem } from '../model';
import { githubUser, noteShape } from './session';

export function reviewersOf(input: { requests: unknown; latestOpinionatedReviews: unknown; timeline: TimelineItem[]; author: string }): ReviewerSummary[] {
  noteShape('page_data/review_requests', input.requests);
  const byLogin = new Map<string, ReviewerSummary>();

  const requests = (input.requests as { pendingReviewRequests?: unknown } | null)?.pendingReviewRequests;
  for (const request of (Array.isArray(requests) ? requests : []) as Array<{ reviewer?: RawReviewer }>) {
    const reviewer = request.reviewer;
    const login = reviewer?.displayLogin ?? reviewer?.login ?? reviewer?.combinedSlug ?? reviewer?.slug;
    if (!reviewer || !login) continue;
    const isTeam = reviewer.reviewerType === 'Team' || reviewer.__typename === 'Team' || !!reviewer.slug;
    // Teams have no avatar; an `org/team` slug links to the team page.
    const user = isTeam ? { login, avatarUrl: '', url: login.includes('/') ? `https://github.com/orgs/${login.replace('/', '/teams/')}` : '' } : githubUser(login, reviewer.avatarUrl);
    byLogin.set(login, { kind: isTeam ? 'team' : 'user', user, state: 'PENDING' });
  }

  // A writer's latest approval or change request replaces their pending request.
  const opinionated = Array.isArray(input.latestOpinionatedReviews)
    ? (input.latestOpinionatedReviews as Array<{ author?: RawReviewer | null; state?: string }>).flatMap((review) => {
        const login = review.author?.login ?? review.author?.displayLogin;
        return login && review.state ? [{ login, avatarUrl: review.author?.avatarUrl, state: review.state.toUpperCase() }] : [];
      })
    : input.timeline.flatMap((item) => (item.kind === 'review' && item.state !== 'COMMENTED' ? [{ login: item.author.login, avatarUrl: item.author.avatarUrl, state: item.state }] : []));
  for (const review of opinionated) {
    if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED' || review.state === 'DISMISSED') {
      byLogin.set(review.login, { kind: 'user', user: githubUser(review.login, review.avatarUrl), state: review.state });
    }
  }
  // Anyone else who reviewed only commented.
  for (const item of input.timeline) {
    if (item.kind === 'review' && !byLogin.has(item.author.login)) byLogin.set(item.author.login, { kind: 'user', user: item.author, state: 'COMMENTED' });
  }
  byLogin.delete(input.author);
  return [...byLogin.values()];
}

/** The review verdict as GitHub's merge box words it: changes requested beats approval; too few approvals is "required". */
export function reviewDecisionOf(reviewers: ReviewerSummary[], numReviewsRequired: number): ReviewDecision {
  const approvals = reviewers.filter((reviewer) => reviewer.state === 'APPROVED').length;
  if (reviewers.some((reviewer) => reviewer.state === 'CHANGES_REQUESTED')) return 'CHANGES_REQUESTED';
  if (approvals < numReviewsRequired) return 'REVIEW_REQUIRED';
  if (approvals > 0) return 'APPROVED';
  return reviewers.some((reviewer) => reviewer.state === 'PENDING') ? 'REVIEW_REQUIRED' : 'NONE';
}

interface RawReviewer {
  __typename?: string;
  login?: string;
  displayLogin?: string;
  slug?: string;
  combinedSlug?: string;
  avatarUrl?: string;
  reviewerType?: string;
}
