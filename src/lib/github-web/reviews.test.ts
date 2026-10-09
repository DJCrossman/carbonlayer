import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../model';
import { reviewDecisionOf, reviewersOf } from './reviews';

describe('reviewersOf', () => {
  const review = (login: string, state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'): TimelineItem => ({
    kind: 'review',
    id: `r-${login}-${state}`,
    author: { login, avatarUrl: '', url: `https://github.com/${login}` },
    state,
    bodyHtml: '',
    createdAt: '2026-10-01T00:00:00Z',
    url: '',
    threadIds: [],
  });
  const requests = {
    pendingReviewRequests: [
      { reviewer: { displayLogin: 'ana', avatarUrl: 'https://a/ana', reviewerType: 'User' } },
      { reviewer: { displayLogin: 'acme/core', reviewerType: 'Team' } },
    ],
  };

  it("starts from pending requests, applies each reviewer's latest verdict, and adds commenters, without the author", () => {
    const timeline = [review('ana', 'CHANGES_REQUESTED'), review('ana', 'APPROVED'), review('bo', 'COMMENTED'), review('me', 'COMMENTED')];
    expect(reviewersOf({ requests, latestOpinionatedReviews: null, timeline, author: 'me' }).map((r) => [r.kind, r.user.login, r.state])).toEqual([
      ['user', 'ana', 'APPROVED'],
      ['team', 'acme/core', 'PENDING'],
      ['user', 'bo', 'COMMENTED'],
    ]);
  });

  it("prefers the merge box's latest opinionated reviews over the timeline", () => {
    const reviewers = reviewersOf({ requests, latestOpinionatedReviews: [{ author: { login: 'ana' }, state: 'CHANGES_REQUESTED' }], timeline: [review('ana', 'APPROVED')], author: 'me' });
    expect(reviewers.find((r) => r.user.login === 'ana')?.state).toBe('CHANGES_REQUESTED');
  });
});

describe('reviewDecisionOf', () => {
  const reviewer = (state: 'APPROVED' | 'CHANGES_REQUESTED' | 'PENDING') => ({ kind: 'user' as const, user: { login: state, avatarUrl: '', url: '' }, state });

  it('ranks changes requested over approval and counts required approvals', () => {
    expect(reviewDecisionOf([reviewer('APPROVED'), reviewer('CHANGES_REQUESTED')], 0)).toBe('CHANGES_REQUESTED');
    expect(reviewDecisionOf([reviewer('APPROVED')], 2)).toBe('REVIEW_REQUIRED');
    expect(reviewDecisionOf([reviewer('APPROVED')], 1)).toBe('APPROVED');
    expect(reviewDecisionOf([reviewer('PENDING')], 0)).toBe('REVIEW_REQUIRED');
    expect(reviewDecisionOf([], 0)).toBe('NONE');
  });
});
