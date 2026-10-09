import { describe, expect, it } from 'vitest';
import { summarisePullRequest, viewSearches } from './inbox';
import type { PullRequestCard } from './queries';

describe('viewSearches', () => {
  const now = new Date('2026-10-09T12:00:00Z');

  it('scopes the query, limits it to PRs and sorts by recent activity', () => {
    expect(viewSearches([{ id: 'a', name: 'Mine', query: 'author:@me merged:>={{7d}}' }], 'org:acme', now)).toEqual([
      { query: 'org:acme author:@me merged:>=2026-10-02 is:pr sort:updated-desc', first: 50 },
    ]);
  });

  it("keeps the view's own sort and type, and clamps the page size to GitHub's 1–100", () => {
    const views = [
      { id: 'a', name: 'A', query: 'is:pr sort:created-asc', limit: 500 },
      { id: 'b', name: 'B', query: 'type:pr', limit: 0 },
    ];
    expect(viewSearches(views, '', now)).toEqual([
      { query: 'is:pr sort:created-asc', first: 100 },
      { query: 'type:pr sort:updated-desc', first: 1 },
    ]);
  });
});

describe('summarisePullRequest', () => {
  it('derives merge status, unread, native stack and auto-merge', () => {
    expect(summarisePullRequest(card({ isDraft: true, mergeStateStatus: 'CLEAN' })).mergeStatus).toBe('DRAFT');
    expect(summarisePullRequest(card({ mergeStateStatus: null })).mergeStatus).toBe('UNKNOWN');
    const summary = summarisePullRequest(
      card({ isReadByViewer: false, stack: { size: 3 }, stackEntry: { position: 2 }, autoMergeRequest: { mergeMethod: 'SQUASH' }, reviewDecision: null }),
    );
    expect(summary).toMatchObject({ unread: true, nativeStack: { position: 2, size: 3 }, autoMerge: { method: 'SQUASH' }, reviewDecision: 'NONE' });
    expect(summarisePullRequest(card({ isReadByViewer: null })).unread).toBeNull();
  });

  it('merges review requests with the latest reviews, leaving out the author', () => {
    const { reviewers } = summarisePullRequest(
      card({
        reviewRequests: {
          nodes: [
            { requestedReviewer: { __typename: 'User', ...user('ana') } },
            { requestedReviewer: { __typename: 'User', ...user('bo') } },
            { requestedReviewer: { __typename: 'Team', slug: 'core', combinedSlug: 'acme/core', url: 'https://github.com/orgs/acme/teams/core' } },
          ],
        },
        latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: user('ana') }] },
        latestReviews: {
          nodes: [
            { state: 'APPROVED', author: user('ana') },
            { state: 'COMMENTED', author: user('cy') },
            { state: 'DISMISSED', author: user('di') },
            { state: 'COMMENTED', author: user('octocat') },
          ],
        },
      }),
    );
    expect(reviewers.map((reviewer) => [reviewer.kind, reviewer.user.login, reviewer.state])).toEqual([
      ['user', 'ana', 'APPROVED'],
      ['user', 'bo', 'PENDING'],
      ['team', 'acme/core', 'PENDING'],
      ['user', 'cy', 'COMMENTED'],
      ['user', 'di', 'DISMISSED'],
    ]);
  });
});

function user(login: string) {
  return { login, avatarUrl: `https://avatars.example/${login}`, url: `https://github.com/${login}` };
}

function card(overrides: Partial<PullRequestCard>): PullRequestCard {
  return {
    id: 'PR_1',
    number: 1,
    title: 'Add widgets',
    url: 'https://github.com/acme/widgets/pull/1',
    isDraft: false,
    state: 'OPEN',
    isReadByViewer: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    mergedAt: null,
    author: user('octocat'),
    repository: { name: 'widgets', owner: { login: 'acme' } },
    headRefName: 'feature',
    baseRefName: 'main',
    reviewDecision: 'REVIEW_REQUIRED',
    mergeStateStatus: 'BLOCKED',
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    totalCommentsCount: 3,
    isInMergeQueue: false,
    autoMergeRequest: null,
    stackEntry: null,
    stack: null,
    labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    latestReviews: { nodes: [] },
    commits: { nodes: [] },
    ...overrides,
  };
}
