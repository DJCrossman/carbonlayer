import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../model';
import { reviewDecisionOf, reviewerCandidatesFrom, reviewersOf } from './reviews';

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

  it("takes verdicts, ids and re-request permission from GitHub's completed reviews when it sends them", () => {
    const reviewers = reviewersOf({
      requests: {
        pendingReviewRequests: [
          { reviewer: { id: '11', displayLogin: 'ana', reviewerType: 'User' } },
          { reviewer: { id: '12', displayLogin: 'bo', reviewerType: 'User' } },
          { reviewer: { id: '90', displayLogin: 'acme/core', avatarUrl: 'https://avatars/t/90', reviewerType: 'Team' } },
          { reviewer: { id: '77', displayLogin: 'copilot', slug: 'copilot', reviewerType: 'User' } },
        ],
        completedReviews: [
          { reviewer: { id: '11', displayLogin: 'ana' }, state: 'REVIEW_STATE_APPROVED', submittedAt: '2026-10-02T00:00:00Z', canReRequest: true },
          { reviewer: { id: '12', displayLogin: 'bo' }, state: 'REVIEW_STATE_COMMENTED', submittedAt: '2026-10-02T00:00:00Z', canReRequest: false },
          { reviewer: { id: '13', displayLogin: 'cy' }, state: 'REVIEW_STATE_CHANGES_REQUESTED', submittedAt: '2026-10-01T00:00:00Z', canReRequest: true },
          { reviewer: { id: '13', displayLogin: 'cy' }, state: 'REVIEW_STATE_DISMISSED', submittedAt: '2026-10-03T00:00:00Z', canReRequest: true },
          { reviewer: { id: '14', displayLogin: 'me' }, state: 'REVIEW_STATE_PENDING', submittedAt: '2026-10-03T00:00:00Z' },
        ],
      },
      latestOpinionatedReviews: null,
      timeline: [review('dee', 'APPROVED')],
      author: 'me',
    });
    expect(reviewers.map((r) => [r.kind, r.user.login, r.state, r.id, r.canReRequest])).toEqual([
      ['user', 'ana', 'APPROVED', '11', true],
      ['user', 'bo', 'PENDING', '12', false],
      ['team', 'acme/core', 'PENDING', '90', false],
      ['user', 'copilot', 'PENDING', '77', false],
      ['user', 'cy', 'DISMISSED', '13', true],
    ]);
    expect(reviewers.find((r) => r.kind === 'team')?.user).toEqual({ login: 'acme/core', avatarUrl: 'https://avatars/t/90', url: 'https://github.com/orgs/acme/teams/core' });
  });

  it("prefers the merge box's latest opinionated reviews over the timeline", () => {
    const reviewers = reviewersOf({ requests, latestOpinionatedReviews: [{ author: { login: 'ana' }, state: 'CHANGES_REQUESTED' }], timeline: [review('ana', 'APPROVED')], author: 'me' });
    expect(reviewers.find((r) => r.user.login === 'ana')?.state).toBe('CHANGES_REQUESTED');
  });
});

describe('reviewerCandidatesFrom', () => {
  const reviewer = (id: string, displayLogin: string, name?: string, reviewerType = 'User') => ({ id, displayLogin, name, avatarUrl: `https://avatars/${id}`, reviewerType });

  it('lists suggestions matching the search first, then everyone else not already suggested', () => {
    const suggested = { suggestedReviewers: [{ reviewer: reviewer('1', 'ana', 'Ana Lima'), description: 'Recently edited these files' }, { reviewer: reviewer('2', 'bo') }] };
    const available = { availableReviewers: [reviewer('1', 'ana', 'Ana Lima'), reviewer('3', 'acme/core', 'Core', 'Team'), { displayLogin: 'no-id' }] };
    expect(reviewerCandidatesFrom(available, suggested, '')).toEqual({
      suggested: [
        { id: '1', login: 'ana', name: 'Ana Lima', avatarUrl: 'https://avatars/1', kind: 'user' },
        { id: '2', login: 'bo', name: null, avatarUrl: 'https://avatars/2', kind: 'user' },
      ],
      reviewers: [{ id: '3', login: 'acme/core', name: 'Core', avatarUrl: 'https://avatars/3', kind: 'team' }],
    });
    expect(reviewerCandidatesFrom(available, suggested, ' LIMA ').suggested.map((candidate) => candidate.login)).toEqual(['ana']);
  });

  it('is empty when GitHub answers {} (signed out)', () => {
    expect(reviewerCandidatesFrom({}, {}, '')).toEqual({ suggested: [], reviewers: [] });
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
