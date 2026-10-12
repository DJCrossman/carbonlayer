import { describe, expect, it } from 'vitest';
import type { CheckRunSummary, CiSummary, PrSummary, ReviewerSummary } from '../lib/model';
import { ciStatusIcon, mergeStatusIcon, reviewStatusIcon } from './status-icons';

describe('the Review column', () => {
  const open = { isDraft: false, reviewDecision: 'REVIEW_REQUIRED' as const };

  it.each([
    ['no reviewers at all', [], undefined, ['dash', 'subtle', 'No reviewers requested']],
    ['others approved; a comment is not a review', [reviewer('jlord', 'APPROVED'), reviewer('copilot', 'COMMENTED')], undefined, ['person-check', 'success', 'Reviewed by jlord']],
    ['only a bot commented', [reviewer('copilot', 'COMMENTED')], undefined, ['dash', 'subtle', 'No reviews yet (copilot commented)']],
    ['the viewer approved', [reviewer('octocat', 'APPROVED'), reviewer('jlord', 'COMMENTED')], undefined, ['check-circle-fill', 'success', 'Approved by you']],
    ['the enrichment says the viewer approved', [reviewer('jlord', 'COMMENTED')], 'APPROVED', ['check-circle-fill', 'success', 'Approved by you']],
    ['someone requested changes, whoever approved', [reviewer('octocat', 'APPROVED'), reviewer('mona', 'CHANGES_REQUESTED')], undefined, ['pencil', 'severe', 'Changes requested by mona']],
    ['requests nobody answered', [reviewer('acme/parcs', 'PENDING'), reviewer('octocat', 'PENDING')], undefined, ['clock', 'severe', 'Waiting for acme/parcs, you']],
    ['the viewer requested changes', [reviewer('octocat', 'CHANGES_REQUESTED')], undefined, ['pencil', 'severe', 'Changes requested by you']],
    ['some reviewed, some still asked', [reviewer('jlord', 'APPROVED'), reviewer('acme/parcs', 'PENDING')], undefined, ['person-check', 'success', 'Reviewed by jlord; waiting for acme/parcs']],
    ['only the viewer commented', [reviewer('octocat', 'COMMENTED')], undefined, ['dash', 'subtle', 'No reviews yet (you commented)']],
  ] as const)('%s', (_, reviewers, viewerReview, [icon, tone, tooltip]) => {
    expect(reviewStatusIcon({ ...open, reviewers: [...reviewers], viewerReview }, 'octocat')).toEqual({ icon, tone, tooltip });
  });

  it('shows a grey pencil for a draft, whatever its reviews say', () => {
    expect(reviewStatusIcon({ isDraft: true, reviewDecision: 'APPROVED', reviewers: [reviewer('jlord', 'APPROVED')] }, 'octocat')).toEqual({
      icon: 'pencil',
      tone: 'subtle',
      tooltip: 'Draft',
    });
  });

  it.each([
    ['APPROVED', 'person-check', 'Approved'],
    ['CHANGES_REQUESTED', 'pencil', 'Changes requested'],
    ['REVIEW_REQUIRED', 'clock', 'Waiting for review'],
    ['NONE', 'dash', 'No review required'],
  ] as const)("goes by the dashboard's %s until GitHub names the reviewers", (reviewDecision, icon, tooltip) => {
    expect(reviewStatusIcon({ isDraft: false, reviewDecision, reviewers: null }, 'octocat')).toMatchObject({ icon, tooltip });
  });
});

describe('the CI column', () => {
  it.each([
    ['no checks', ci([]), null, ['dash', 'subtle', 'No checks']],
    ['every check passed', ci([check('build', 'SUCCESS'), check('lint', 'SUCCESS')]), null, ['check-circle-fill', 'success', 'All checks passed']],
    ['checks still running', ci([check('build', 'SUCCESS'), check('e2e', 'PENDING'), check('lint', 'PENDING')]), null, ['clock', 'severe', 'Checks running (1/3)']],
    ['a required check failing', ci([check('build', 'FAILURE'), check('preview', 'FAILURE')]), ['build'], ['x-circle-fill', 'danger', 'Required checks failing: build']],
    ['only optional checks failing', ci([check('build', 'SUCCESS'), check('preview', 'FAILURE')]), ['build'], ['check-circle-fill', 'attention', 'Non-required checks failing: preview']],
    ['a failure before GitHub says which are required', ci([check('preview', 'FAILURE')]), null, ['x-circle-fill', 'danger', 'Checks failing (1 of 1): preview']],
  ] as const)('%s', (_, summary, required, [icon, tone, tooltip]) => {
    expect(ciStatusIcon(summary, required === null ? null : [...required])).toEqual({ icon, tone, tooltip });
  });

  it("counts from the dashboard's rollup when it has no check list", () => {
    expect(ciStatusIcon({ state: 'PENDING', checks: [], counts: { success: 8, failure: 0, pending: 2, other: 0 } }, null).tooltip).toBe('Checks running (8/10)');
    expect(ciStatusIcon({ state: 'FAILURE', checks: [], counts: { success: 7, failure: 3, pending: 0, other: 0 } }, ['build']).tooltip).toBe('Checks failing (3 of 10)');
  });
});

describe('the Merge column', () => {
  const pr: Pick<PrSummary, 'state' | 'isDraft' | 'mergeStatus' | 'isInMergeQueue' | 'autoMerge'> = { state: 'OPEN', isDraft: false, mergeStatus: 'CLEAN', isInMergeQueue: false, autoMerge: null };

  it.each([
    ['mergeable', { mergeStatus: 'CLEAN' }, ['check-circle-fill', 'success', 'Mergeable']],
    ['mergeable once hooks pass', { mergeStatus: 'HAS_HOOKS' }, ['check-circle-fill', 'success', 'Mergeable']],
    ['merged', { state: 'MERGED', mergeStatus: 'UNKNOWN' }, ['git-merge', 'done', 'Merged']],
    ['closed', { state: 'CLOSED', mergeStatus: 'UNKNOWN' }, ['git-pull-request-closed', 'danger', 'Closed']],
    ['conflicting', { mergeStatus: 'DIRTY' }, ['x-circle-fill', 'danger', 'Merge conflict']],
    ['held back by reviews or checks, like Graphite: no conflict', { mergeStatus: 'BLOCKED' }, ['check-circle-fill', 'success', 'No merge conflicts; blocked on GitHub: required reviews or checks are missing']],
    ['behind its base', { mergeStatus: 'BEHIND' }, ['check-circle-fill', 'success', 'No merge conflicts; blocked on GitHub: the branch is behind its base']],
    ['optional checks failing', { mergeStatus: 'UNSTABLE' }, ['check-circle-fill', 'success', 'No merge conflicts; blocked on GitHub: some checks are failing']],
    ['a conflicting draft, like any other PR', { isDraft: true, mergeStatus: 'DIRTY' }, ['x-circle-fill', 'danger', 'Merge conflict']],
    ['a draft GitHub has not described', { isDraft: true, mergeStatus: 'DRAFT' }, ['dash', 'subtle', 'Unknown']],
    ['not known yet', { mergeStatus: 'UNKNOWN' }, ['dash', 'subtle', 'Unknown']],
    ['in the merge queue', { isInMergeQueue: true }, ['git-merge', 'accent', 'Queued in the merge queue']],
  ] as const)('%s', (_, fields, [icon, tone, tooltip]) => {
    expect(mergeStatusIcon({ ...pr, ...fields })).toEqual({ icon, tone, tooltip });
  });

  it("says why a pull request is blocked when the merge box did", () => {
    expect(mergeStatusIcon({ ...pr, mergeStatus: 'BLOCKED' }, 'At least 1 approving review is required').tooltip).toBe('No merge conflicts; blocked on GitHub: At least 1 approving review is required');
  });
});

function reviewer(login: string, state: ReviewerSummary['state']): ReviewerSummary {
  return { kind: login.includes('/') ? 'team' : 'user', user: { login, avatarUrl: '', url: '' }, state };
}

function check(name: string, state: CheckRunSummary['state']): CheckRunSummary {
  return { name, state, url: null, description: null, group: null, startedAt: null, completedAt: null, runId: null };
}

function ci(checks: CheckRunSummary[]): CiSummary {
  const counts = {
    success: checks.filter((c) => c.state === 'SUCCESS').length,
    failure: checks.filter((c) => c.state === 'FAILURE').length,
    pending: checks.filter((c) => c.state === 'PENDING').length,
    other: 0,
  };
  return { state: counts.failure > 0 ? 'FAILURE' : counts.pending > 0 ? 'PENDING' : counts.success > 0 ? 'SUCCESS' : 'NONE', checks, counts };
}
