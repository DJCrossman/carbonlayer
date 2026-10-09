import { describe, expect, it } from 'vitest';
import type { PrSummary, Stack } from '../model';
import { pullRequestDetail, type PagePullRequest, type PageRepository } from './pull-request';

describe('pullRequestDetail', () => {
  const author = { login: 'ana', avatarUrl: '', url: 'https://github.com/ana' };

  const pr = {
    body: 'Body',
    bodyHTML: '<p>Body</p>',
    headRefOid: 'head',
    baseRefOid: 'base',
    state: 'OPEN',
    viewerCanUpdate: true,
    viewerDidAuthor: false,
    viewerCanEnableAutoMerge: true,
    assignees: { nodes: [author, null] },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  { __typename: 'CheckRun', name: 'build', isRequired: true },
                  { __typename: 'CheckRun', name: 'docs', isRequired: false },
                  { __typename: 'StatusContext', context: 'ci/legacy', isRequired: true },
                ],
              },
            },
          },
        },
      ],
    },
    files: null,
    reviewThreads: {
      nodes: [
        thread('T1', { reviewId: 'R1', isResolved: false }),
        thread('T2', { reviewId: 'R1', isResolved: true }),
        thread('T3', { reviewId: 'R2', isResolved: false, isOutdated: true }),
      ],
    },
    timelineItems: {
      nodes: [
        { __typename: 'PullRequestCommit', id: 'C1', url: 'u', commit: { oid: 'abc123', abbreviatedOid: 'abc', messageHeadline: 'Start', committedDate: 't1', author: { user: null } } },
        { __typename: 'ReviewRequestedEvent', id: 'E1', createdAt: 't2', actor: author, requestedReviewer: { __typename: 'Team', slug: 'core' } },
        { __typename: 'PullRequestReview', id: 'R1', state: 'CHANGES_REQUESTED', bodyHTML: '', submittedAt: 't3', createdAt: 't0', url: 'u', author },
        { __typename: 'IssueComment', id: 'IC1', author: null, body: 'hi', bodyHTML: '<p>hi</p>', createdAt: 't4', url: 'u' },
        { __typename: 'HeadRefForcePushedEvent', id: 'F1', createdAt: 't5', actor: null, beforeCommit: { oid: 'old' }, afterCommit: null },
        { __typename: 'MergedEvent', id: 'M1', createdAt: 't6', actor: author },
        null,
      ],
    },
  } as unknown as PagePullRequest;

  const repository = {
    viewerPermission: 'WRITE',
    viewerDefaultMergeMethod: 'SQUASH',
    mergeCommitAllowed: false,
    squashMergeAllowed: true,
    rebaseMergeAllowed: true,
  } as PageRepository;

  const detail = pullRequestDetail({
    viewerLogin: 'me',
    repository,
    pr,
    summary: { number: 1, title: 'Add widgets' } as PrSummary,
    files: [
      { filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, patch: '@@', blob_url: 'b' },
      { filename: 'img.png', previous_filename: 'old.png', status: 'renamed', additions: 0, deletions: 0, blob_url: 'b' },
    ],
    viewedStates: new Map([['a.ts', 'VIEWED']]),
    stack: { entries: [], currentIndex: 0, trunk: 'main', source: 'none' } as Stack,
  });

  it('turns the timeline into the model kinds, linking reviews to the threads they opened', () => {
    expect(detail.timeline.map((item) => item.kind)).toEqual(['commit', 'review-requested', 'review', 'comment', 'force-push', 'merged']);
    expect(detail.timeline).toContainEqual(expect.objectContaining({ kind: 'review', createdAt: 't3', threadIds: ['T1', 'T2'] }));
    expect(detail.timeline).toContainEqual(expect.objectContaining({ kind: 'review-requested', requested: 'core' }));
    expect(detail.timeline).toContainEqual(expect.objectContaining({ kind: 'comment', author: expect.objectContaining({ login: 'ghost' }) }));
  });

  it('counts unresolved threads and drops the line of outdated ones', () => {
    expect(detail.unresolvedThreadCount).toBe(2);
    expect(detail.threads.find((t) => t.id === 'T3')).toMatchObject({ line: null, isOutdated: true, diffHunk: '@@ -1 +1 @@' });
  });

  it('merges viewed state into the REST files', () => {
    expect(detail.files).toEqual([
      { path: 'a.ts', previousPath: null, status: 'modified', additions: 1, deletions: 0, patch: '@@', viewerViewedState: 'VIEWED', blobUrl: 'b' },
      { path: 'img.png', previousPath: 'old.png', status: 'renamed', additions: 0, deletions: 0, patch: null, viewerViewedState: 'UNVIEWED', blobUrl: 'b' },
    ]);
  });

  it('derives merge permissions and required checks', () => {
    expect(detail).toMatchObject({
      allowedMergeMethods: ['SQUASH', 'REBASE'],
      defaultMergeMethod: 'SQUASH',
      viewerCanMerge: true,
      requiredCheckNames: ['build', 'ci/legacy'],
      assignees: [author],
      viewerLogin: 'me',
    });
    const readOnly = pullRequestDetail({ viewerLogin: 'me', repository: { ...repository, viewerPermission: 'TRIAGE' }, pr, summary: {} as PrSummary, files: [], viewedStates: new Map(), stack: detail.stack });
    expect(readOnly.viewerCanMerge).toBe(false);
  });
});

function thread(id: string, options: { reviewId: string; isResolved: boolean; isOutdated?: boolean }) {
  return {
    id,
    isResolved: options.isResolved,
    isOutdated: options.isOutdated ?? false,
    path: 'a.ts',
    line: 4,
    startLine: null,
    diffSide: 'RIGHT',
    comments: {
      nodes: [
        { id: `${id}-c`, author: null, body: 'x', bodyHTML: '<p>x</p>', createdAt: 't', url: 'u', diffHunk: '@@ -1 +1 @@', pullRequestReview: { id: options.reviewId } },
      ],
    },
  };
}
