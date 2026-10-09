// Who reviews the PR and where they stand. Requests and completed reviews come from page_data/review_requests
// (observed: `{ pendingReviewRequests: [{ reviewer }], completedReviews: [{ reviewer, state, submittedAt, canReRequest }] }`
// with `reviewer` = `{ id, displayLogin, name, avatarUrl, reviewerType: "User" | "Team" }`; completed reviews need a
// session). Without them, verdicts come from the merge box's `latestOpinionatedReviews` when present, else from the reviews
// in the timeline. Whom the viewer can ask instead comes from GitHub's reviewer picker routes (see reviewerCandidatesFrom).

import type { ReviewDecision, ReviewerCandidate, ReviewerSummary, TimelineItem } from '../model';
import { githubUser, noteShape } from './session';

export function reviewersOf(input: { requests: unknown; latestOpinionatedReviews: unknown; timeline: TimelineItem[]; author: string }): ReviewerSummary[] {
  noteShape('page_data/review_requests', input.requests);
  const { pendingReviewRequests, completedReviews } = (input.requests ?? {}) as { pendingReviewRequests?: unknown; completedReviews?: unknown };
  const byLogin = new Map<string, ReviewerSummary>();

  for (const request of (Array.isArray(pendingReviewRequests) ? pendingReviewRequests : []) as Array<{ reviewer?: RawReviewer }>) {
    const reviewer = request.reviewer;
    const login = reviewer?.displayLogin ?? reviewer?.login ?? reviewer?.combinedSlug ?? reviewer?.slug;
    if (!reviewer || !login) continue;
    // Bots carry a `slug` too, so only the type says team. An `org/team` login links to the team page.
    const isTeam = reviewer.reviewerType === 'Team' || reviewer.__typename === 'Team';
    const user = isTeam
      ? { login, avatarUrl: reviewer.avatarUrl ?? '', url: login.includes('/') ? `https://github.com/orgs/${login.replace('/', '/teams/')}` : '' }
      : githubUser(login, reviewer.avatarUrl);
    byLogin.set(login, { kind: isTeam ? 'team' : 'user', user, state: 'PENDING', id: reviewer.id, canReRequest: false });
  }

  if (Array.isArray(completedReviews)) {
    // GitHub lists one completed review per reviewer; should there be more, the latest counts. A verdict replaces a
    // pending request (re-requested reviewers keep their approval); a comment does not.
    const oldestFirst = (completedReviews as RawCompletedReview[]).toSorted((a, b) => Date.parse(a.submittedAt ?? '') - Date.parse(b.submittedAt ?? ''));
    for (const review of oldestFirst) {
      const login = review.reviewer?.displayLogin ?? review.reviewer?.login;
      const state = review.state?.replace(/^REVIEW_STATE_/, '');
      if (!login || (state !== 'APPROVED' && state !== 'CHANGES_REQUESTED' && state !== 'COMMENTED' && state !== 'DISMISSED')) continue;
      if (state === 'COMMENTED' && byLogin.has(login)) continue;
      byLogin.set(login, { kind: 'user', user: githubUser(login, review.reviewer?.avatarUrl), state, id: review.reviewer?.id, canReRequest: review.canReRequest === true });
    }
  } else {
    // A writer's latest approval or change request replaces their pending request.
    const opinionated = Array.isArray(input.latestOpinionatedReviews)
      ? (input.latestOpinionatedReviews as Array<{ author?: RawReviewer | null; state?: string }>).flatMap((review) => {
          const login = review.author?.login ?? review.author?.displayLogin;
          return login && typeof review.state === 'string' ? [{ login, avatarUrl: review.author?.avatarUrl, state: review.state.toUpperCase() }] : [];
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

/**
 * Whom GitHub's reviewer picker offers, from `page_data/suggested_reviewers` (`{ suggestedReviewers: [{ reviewer,
 * description }] }`) and `page_data/reviewers[?q=]` (`{ availableReviewers: [reviewer] }`); both shapes are read from GitHub's
 * bundle, signed out they are `{}`. Suggestions are narrowed to `query` here, since GitHub returns them unfiltered; everyone
 * else leaves out who is already suggested.
 */
export function reviewerCandidatesFrom(available: unknown, suggested: unknown, query: string): { suggested: ReviewerCandidate[]; reviewers: ReviewerCandidate[] } {
  noteShape('page_data/reviewers', available);
  noteShape('page_data/suggested_reviewers', suggested);
  const candidates = (raw: unknown) =>
    (Array.isArray(raw) ? (raw as Array<RawReviewer | null>) : []).flatMap((reviewer): ReviewerCandidate[] => {
      const login = reviewer?.displayLogin ?? reviewer?.login;
      if (!reviewer?.id || !login) return [];
      const kind = reviewer.reviewerType === 'Team' || reviewer.__typename === 'Team' ? 'team' : 'user';
      return [{ id: String(reviewer.id), login, name: reviewer.name || null, avatarUrl: reviewer.avatarUrl ?? '', kind }];
    });
  const needle = query.trim().toLowerCase();
  const { suggestedReviewers } = (suggested ?? {}) as { suggestedReviewers?: unknown };
  const suggestions = candidates(Array.isArray(suggestedReviewers) ? suggestedReviewers.map((entry: { reviewer?: RawReviewer } | null) => entry?.reviewer) : []).filter(
    (candidate) => !needle || candidate.login.toLowerCase().includes(needle) || !!candidate.name?.toLowerCase().includes(needle),
  );
  const everyone = candidates(((available ?? {}) as { availableReviewers?: unknown }).availableReviewers);
  return { suggested: suggestions, reviewers: everyone.filter((candidate) => !suggestions.some((suggestion) => suggestion.id === candidate.id)) };
}

interface RawReviewer {
  __typename?: string;
  id?: string;
  login?: string;
  displayLogin?: string;
  name?: string;
  slug?: string;
  combinedSlug?: string;
  avatarUrl?: string;
  reviewerType?: string;
}

interface RawCompletedReview {
  reviewer?: RawReviewer;
  /** REVIEW_STATE_APPROVED | _COMMENTED | _CHANGES_REQUESTED | _DISMISSED | _PENDING */
  state?: string;
  submittedAt?: string;
  canReRequest?: boolean;
}
