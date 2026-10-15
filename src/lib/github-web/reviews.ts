// Who reviews the PR and where they stand. Requests and completed reviews come from page_data/review_requests
// (observed: `{ pendingReviewRequests: [{ reviewer }], completedReviews: [{ reviewer, state, submittedAt, canReRequest }] }`
// with `reviewer` = `{ id, displayLogin, name, avatarUrl, reviewerType: "User" | "Team" }`; completed reviews need a
// session). Without them, verdicts come from the merge box's `latestOpinionatedReviews` when present, else from the reviews
// in the timeline. Whom the viewer can ask instead comes from GitHub's reviewer picker routes (see reviewerCandidatesFrom).

import { z } from 'zod';
import type { ReviewDecision, ReviewerCandidate, ReviewerSummary, TimelineItem } from '../model';
import { githubUser } from './session';

export function reviewersOf(input: {
  requests: ReviewRequestsAnswer | null;
  latestOpinionatedReviews: OpinionatedReview[] | null | undefined;
  timeline: TimelineItem[];
  author: string;
}): ReviewerSummary[] {
  const { pendingReviewRequests, completedReviews } = input.requests ?? {};
  const byLogin = new Map<string, ReviewerSummary>();

  for (const request of pendingReviewRequests ?? []) {
    const reviewer = request.reviewer;
    const login = reviewer?.displayLogin ?? reviewer?.login ?? reviewer?.combinedSlug ?? reviewer?.slug;
    if (!reviewer || !login) continue;
    // Bots carry a `slug` too, so only the type says team. An `org/team` login links to the team page.
    const isTeam = reviewer.reviewerType === 'Team' || reviewer.__typename === 'Team';
    const user = isTeam
      ? { login, avatarUrl: reviewer.avatarUrl ?? '', url: login.includes('/') ? `https://github.com/orgs/${login.replace('/', '/teams/')}` : '' }
      : githubUser(login, reviewer.avatarUrl);
    byLogin.set(login, { kind: isTeam ? 'team' : 'user', user, state: 'PENDING', id: reviewer.id ?? undefined, canReRequest: false });
  }

  if (completedReviews) {
    // GitHub lists one completed review per reviewer; should there be more, the latest counts. A verdict replaces a
    // pending request (re-requested reviewers keep their approval); a comment does not.
    const oldestFirst = completedReviews.toSorted((a, b) => Date.parse(a.submittedAt ?? '') - Date.parse(b.submittedAt ?? ''));
    for (const review of oldestFirst) {
      const login = review.reviewer?.displayLogin ?? review.reviewer?.login;
      const state = review.state?.replace(/^REVIEW_STATE_/, '');
      if (!login || (state !== 'APPROVED' && state !== 'CHANGES_REQUESTED' && state !== 'COMMENTED' && state !== 'DISMISSED')) continue;
      if (state === 'COMMENTED' && byLogin.has(login)) continue;
      byLogin.set(login, { kind: 'user', user: githubUser(login, review.reviewer?.avatarUrl), state, id: review.reviewer?.id ?? undefined, canReRequest: review.canReRequest === true });
    }
  } else {
    // A writer's latest approval or change request replaces their pending request.
    const opinionated = input.latestOpinionatedReviews
      ? input.latestOpinionatedReviews.flatMap((review) => {
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
  }
  byLogin.delete(input.author);
  return [...byLogin.values()];
}

/** The review verdict the way GitHub's merge box words it: changes requested beats approval; too few approvals is "required". */
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
export function reviewerCandidatesFrom(
  available: AvailableReviewersAnswer,
  suggested: SuggestedReviewersAnswer,
  query: string,
): { suggested: ReviewerCandidate[]; reviewers: ReviewerCandidate[] } {
  const found: { suggested: ReviewerCandidate[]; reviewers: ReviewerCandidate[] } = { suggested: [], reviewers: [] };
  const listed = [
    ...(suggested.suggestedReviewers ?? []).map((entry) => ({ group: found.suggested, reviewer: entry?.reviewer })),
    ...(available.availableReviewers ?? []).map((reviewer) => ({ group: found.reviewers, reviewer })),
  ];
  const needle = query.trim().toLowerCase();
  for (const { group, reviewer } of listed) {
    const login = reviewer?.displayLogin ?? reviewer?.login;
    if (!reviewer?.id || !login) continue;
    const id = String(reviewer.id);
    const name = reviewer.name || null;
    if (group === found.suggested && needle && !login.toLowerCase().includes(needle) && !name?.toLowerCase().includes(needle)) continue;
    if (group === found.reviewers && found.suggested.some((suggestion) => suggestion.id === id)) continue;
    group.push({ id, login, name, avatarUrl: reviewer.avatarUrl ?? '', kind: reviewer.reviewerType === 'Team' || reviewer.__typename === 'Team' ? 'team' : 'user' });
  }
  return found;
}

/** A user, bot or team, as review requests, reviews and the reviewer picker name them (the fields read here). */
const reviewerSchema = z.object({
  __typename: z.string().nullish(),
  id: z.string().nullish(),
  login: z.string().nullish(),
  displayLogin: z.string().nullish(),
  name: z.string().nullish(),
  slug: z.string().nullish(),
  combinedSlug: z.string().nullish(),
  avatarUrl: z.string().nullish(),
  reviewerType: z.string().nullish(),
});

/** A pending review request, in page_data/review_requests and (where GitHub names them) the merge box. */
export const pendingReviewRequestSchema = z.object({ reviewer: reviewerSchema.nullish() });

/** page_data/review_requests (the fields read here); signed out it is `{}`, and completed reviews need a session. */
export const reviewRequestsAnswer = z.object({
  pendingReviewRequests: z.array(pendingReviewRequestSchema).nullish(),
  completedReviews: z
    .array(
      z.object({
        reviewer: reviewerSchema.nullish(),
        /** REVIEW_STATE_APPROVED | _COMMENTED | _CHANGES_REQUESTED | _DISMISSED | _PENDING */
        state: z.string().nullish(),
        submittedAt: z.string().nullish(),
        canReRequest: z.boolean().nullish(),
      }),
    )
    .nullish(),
});

type ReviewRequestsAnswer = z.infer<typeof reviewRequestsAnswer>;

/** One of the merge box's `latestOpinionatedReviews` (the fields read here). */
export const opinionatedReviewSchema = z.object({ author: reviewerSchema.nullish(), state: z.string().nullish() });

type OpinionatedReview = z.infer<typeof opinionatedReviewSchema>;

/** page_data/reviewers[?q=] (the fields read here). */
export const availableReviewersAnswer = z.object({ availableReviewers: z.array(reviewerSchema.nullable()).nullish() });

type AvailableReviewersAnswer = z.infer<typeof availableReviewersAnswer>;

/** page_data/suggested_reviewers (the fields read here). */
export const suggestedReviewersAnswer = z.object({ suggestedReviewers: z.array(z.object({ reviewer: reviewerSchema.nullish() }).nullable()).nullish() });

type SuggestedReviewersAnswer = z.infer<typeof suggestedReviewersAnswer>;
