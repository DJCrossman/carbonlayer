import { assert, describe, expect, it } from 'vitest';
import { prFixtures } from '../fixtures/pr';
import type { PrDetail } from '../lib/model';
import { nextActionFor, stackRowPillFor } from './next-action';

const pr41 = prFixtures.find((pr) => pr.number === 41);
const pr42 = prFixtures.find((pr) => pr.number === 42);
assert.isDefined(pr41);
assert.isDefined(pr42);

// #41 is the bottom of its stack, approved, green and clean: nothing stands in its way.
const ready: PrDetail = pr41;
const failingCheck = pr42.ci.checks.find((check) => check.state === 'FAILURE');
assert.isDefined(failingCheck);

describe('nextActionFor', () => {
  it('is ready to merge when nothing blocks the PR', () => {
    expect(nextActionFor(ready)).toMatchObject({ kind: 'ready', tone: 'success', title: 'Ready to merge', detail: 'All CI and approval requirements have been met' });
  });

  it('merges over a failing optional check, like GitHub and Graphite, and says so', () => {
    const optional = { ...ready, ci: { ...pr42.ci }, requiredCheckNames: ready.requiredCheckNames.filter((name) => name !== failingCheck.name), mergeStatus: 'UNSTABLE' as const };
    expect(nextActionFor(optional)).toMatchObject({ kind: 'ready', detail: `An optional check is failing: ${failingCheck.name}` });
  });

  it.each<[string, Partial<PrDetail>, string]>([
    ['merged', { state: 'MERGED' }, 'Merged'],
    ['closed', { state: 'CLOSED' }, 'Closed'],
    ['draft', { isDraft: true }, 'Draft'],
    ['conflicts', { mergeStatus: 'DIRTY' }, 'Merge conflicts'],
    ['unresolved', { unresolvedThreadCount: 2 }, 'Unresolved comments'],
    ['checks-failed', { ci: { ...pr42.ci }, requiredCheckNames: [failingCheck.name] }, 'Required checks failed'],
    ['changes-requested', { reviewDecision: 'CHANGES_REQUESTED', reviewers: pr42.reviewers }, 'Changes requested by jlord'],
    ['review-required', { reviewDecision: 'REVIEW_REQUIRED', reviewers: pr42.reviewers }, 'Waiting for review'],
    ['behind', { mergeStatus: 'BEHIND' }, 'Behind main'],
    ['blocked', { mergeStatus: 'BLOCKED' }, 'Blocked by branch protection'],
  ])('names %s', (kind, overrides, title) => {
    expect(nextActionFor({ ...ready, ...overrides })).toMatchObject({ kind, title });
  });

  it("says in GitHub's words what in its stack keeps it from merging, before waiting on the PRs below it; a stack behind its base merges all the same", () => {
    const section = (kind: NonNullable<PrDetail['stackSection']>['kind']) => ({ stackSection: { kind, baseRefName: 'main', viewerCanRebase: true } });
    expect(nextActionFor({ ...pr42, ...section('rebase-required') })).toMatchObject({
      kind: 'stack-rebase',
      title: 'Some branches in this stack have diverged and must be rebased',
      detail: 'Rebase this stack to restore a linear commit history across its branches.',
    });
    expect(nextActionFor({ ...pr42, ...section('conflicts') })).toMatchObject({ kind: 'stack-conflicts', title: 'This stack has conflicts that must be resolved' });
    expect(nextActionFor({ ...pr42, ...section('current-conflicts') })).toMatchObject({
      kind: 'stack-conflicts',
      title: 'This branch has conflicts that must be resolved',
      detail: 'Use the command line to resolve conflicts within the stack before continuing.',
    });
    expect(nextActionFor({ ...ready, ...section('rebase-optional') })).toMatchObject({ kind: 'ready' });
  });

  it('counts finished checks while they run', () => {
    // #42's checks without the failure: 6 finished, 2 still running.
    const checks = pr42.ci.checks.filter((check) => check !== failingCheck);
    const action = nextActionFor({ ...ready, ci: { ...ready.ci, state: 'PENDING', checks } });
    expect(action).toMatchObject({ kind: 'checks-running', title: 'Checks running · 5/7' });
  });

  it('counts the open comment threads', () => {
    expect(nextActionFor({ ...ready, unresolvedThreadCount: 1 })).toMatchObject({ kind: 'unresolved', detail: '1 open comment thread needs resolving before this PR can merge' });
    expect(nextActionFor({ ...ready, unresolvedThreadCount: 2 })).toMatchObject({ kind: 'unresolved', detail: '2 open comment threads need resolving before this PR can merge' });
  });

  it('counts the required checks that failed among all of them', () => {
    expect(nextActionFor({ ...ready, ci: pr42.ci, requiredCheckNames: ['e2e / portal'] })).toMatchObject({ kind: 'checks-failed', detail: '1 of 1 required check failed' });
    // #42's checks with build failing too: build and e2e / portal fail, unit passes.
    const checks = pr42.ci.checks.map((check) => (check.name === 'build' ? { ...check, state: 'FAILURE' as const } : check));
    expect(nextActionFor({ ...ready, ci: { ...pr42.ci, checks }, requiredCheckNames: ['build', 'unit', 'e2e / portal'] })).toMatchObject({
      kind: 'checks-failed',
      detail: '2 of 3 required checks failed',
    });
  });

  it('names the pending reviewers while a review is requested', () => {
    expect(nextActionFor({ ...ready, reviewDecision: 'REVIEW_REQUIRED', reviewers: pr42.reviewers })).toMatchObject({ kind: 'review-required', title: 'Waiting for review', detail: 'acme/parcs' });
  });

  it('asks for more reviewers when the rules want approvals and nobody is requested, with the count where the merge box gives it', () => {
    const unasked: PrDetail = { ...ready, reviewDecision: 'REVIEW_REQUIRED', reviewers: [] };
    expect(nextActionFor({ ...unasked, numReviewsRequired: 1 })).toMatchObject({
      kind: 'needs-reviewers',
      title: 'Needs more reviewers',
      detail: 'Branch rules require 1 approval (0 so far) and no reviewers are requested',
    });
    // #41's approval counts toward the two required.
    expect(nextActionFor({ ...ready, reviewDecision: 'REVIEW_REQUIRED', numReviewsRequired: 2 })).toMatchObject({ detail: 'Branch rules require 2 approvals (1 so far) and no reviewers are requested' });
    expect(nextActionFor(unasked)).toMatchObject({ kind: 'needs-reviewers', detail: 'An approval is required (0 so far) and no reviewers are requested' });
  });

  it('waits on the open PR closest to trunk before anything about this PR', () => {
    const action = nextActionFor(pr42);
    expect(action).toMatchObject({ kind: 'downstack', title: 'Waiting on downstack · #41' });
    expect(action.kind === 'downstack' && action.pr.number).toBe(41);
  });

  it('ignores merged PRs lower in the stack', () => {
    const entries = pr42.stack.entries.map((entry) => (entry.number === 41 ? { ...entry, state: 'MERGED' as const } : entry));
    expect(nextActionFor({ ...pr42, stack: { ...pr42.stack, entries } })).toMatchObject({ kind: 'unresolved' });
  });

  describe('in a stack GitHub merges as one', () => {
    // #42 with nothing of its own in the way: approved, green, its threads resolved. #41 below it is open, #43 above a draft.
    const ready42: PrDetail = { ...pr42, reviewDecision: 'APPROVED', reviewers: ready.reviewers, ci: ready.ci, requiredCheckNames: ready.requiredCheckNames, unresolvedThreadCount: 0, mergeStatus: 'CLEAN' };
    /** #42 in a stack from `source`, whose PRs numbered in `readyAsStack` GitHub says are ready to merge as a stack. */
    const inStack = (source: PrDetail['stack']['source'], readyAsStack: number[]): PrDetail => ({
      ...ready42,
      stack: { ...pr42.stack, source, entries: pr42.stack.entries.map((entry) => ({ ...entry, readyToMergeAsStack: readyAsStack.includes(entry.number) })) },
    });

    it('is ready to merge as a stack when GitHub says every open PR from the bottom up to this one is, and names them', () => {
      const action = nextActionFor(inStack('native', [41, 42]));
      expect(action).toMatchObject({ kind: 'ready-as-stack', tone: 'success', title: 'Ready to merge as stack', detail: 'This PR and all of its downstack PRs can be merged' });
      expect(action.kind === 'ready-as-stack' && action.prs.map((entry) => entry.number)).toEqual([41, 42]);
    });

    it('waits on downstack while GitHub says a PR below this one, or this one, is not ready', () => {
      expect(nextActionFor(inStack('native', [42]))).toMatchObject({ kind: 'downstack', title: 'Waiting on downstack · #41' });
      expect(nextActionFor(inStack('native', [41]))).toMatchObject({ kind: 'downstack', title: 'Waiting on downstack · #41' });
    });

    it('waits on downstack in a stack only Graphite lists, which GitHub does not merge as one', () => {
      expect(nextActionFor(inStack('graphite-comment', [41, 42]))).toMatchObject({ kind: 'downstack', title: 'Waiting on downstack · #41' });
    });

    it("still puts this PR's own steps first", () => {
      expect(nextActionFor({ ...inStack('native', [41, 42]), unresolvedThreadCount: 2 })).toMatchObject({ kind: 'unresolved' });
      expect(nextActionFor({ ...inStack('native', [41, 42]), isDraft: true })).toMatchObject({ kind: 'draft' });
    });

    it('merges this PR alone with nothing open below it, as a single PR does', () => {
      const merged41 = inStack('native', [42]);
      const entries = merged41.stack.entries.map((entry) => (entry.number === 41 ? { ...entry, state: 'MERGED' as const } : entry));
      expect(nextActionFor({ ...merged41, stack: { ...merged41.stack, entries } })).toMatchObject({ kind: 'ready', title: 'Ready to merge' });
      expect(nextActionFor({ ...ready, stack: { entries: [ready], currentIndex: 0, trunk: 'main', source: 'none' } })).toMatchObject({ kind: 'ready', title: 'Ready to merge' });
    });
  });

  it('puts state before conflicts, conflicts before the stack, and the stack before reviews', () => {
    expect(nextActionFor({ ...pr42, isDraft: true, mergeStatus: 'DIRTY' })).toMatchObject({ kind: 'draft' });
    expect(nextActionFor({ ...pr42, mergeStatus: 'DIRTY' })).toMatchObject({
      kind: 'conflicts',
      title: 'Merge conflicts',
      detail: "This PR can't be merged because of a conflict with the base branch",
    });
    expect(nextActionFor({ ...pr42, state: 'MERGED' })).toMatchObject({ kind: 'merged' });
  });

  it('stops at "Checking mergeability…" while a stage the answer depends on has not arrived', () => {
    expect(nextActionFor(ready, ['mergeBox'])).toMatchObject({ kind: 'checking', title: 'Checking mergeability…' });
    expect(nextActionFor(ready, ['checks'])).toMatchObject({ kind: 'checking' });
    expect(nextActionFor({ ...ready, unresolvedThreadCount: 2 }, ['threads'])).toMatchObject({ kind: 'checking' });
  });

  it('answers as far as the stages that arrived allow', () => {
    // The header alone knows a merged PR or a draft; the merge box alone knows about conflicts.
    expect(nextActionFor({ ...ready, state: 'MERGED' }, ['mergeBox', 'stack', 'threads', 'checks'])).toMatchObject({ kind: 'merged' });
    expect(nextActionFor({ ...ready, isDraft: true }, ['mergeBox', 'stack', 'threads', 'checks'])).toMatchObject({ kind: 'draft' });
    expect(nextActionFor({ ...ready, mergeStatus: 'DIRTY' }, ['stack', 'threads', 'checks'])).toMatchObject({ kind: 'conflicts' });
    expect(nextActionFor({ ...ready, unresolvedThreadCount: 1 }, ['checks'])).toMatchObject({ kind: 'unresolved' });
  });
});

describe('stackRowPillFor', () => {
  it('says a merged PR is merged', () => {
    expect(stackRowPillFor({ ...ready, state: 'MERGED' })).toMatchObject({ label: 'Merged', tone: 'done' });
  });

  it('says a closed PR is closed', () => {
    expect(stackRowPillFor({ ...ready, state: 'CLOSED' })).toMatchObject({ label: 'Closed', tone: 'danger' });
  });

  it('says a draft is a draft, whether the PR or its mergeability says so', () => {
    expect(stackRowPillFor({ ...ready, isDraft: true })).toMatchObject({ label: 'Draft', tone: 'neutral' });
    expect(stackRowPillFor({ ...ready, mergeStatus: 'DRAFT' })).toMatchObject({ label: 'Draft', tone: 'neutral' });
  });

  it('says the viewed PR is ready to merge as a stack, and one below it ready to merge, when GitHub merges them as one', () => {
    expect(stackRowPillFor(ready, [], 'viewed')).toMatchObject({ label: 'Ready to merge as stack', tone: 'success' });
    expect(stackRowPillFor(ready, [], 'below')).toMatchObject({ label: 'Ready to merge', tone: 'success' });
  });

  it('says it has merge conflicts', () => {
    expect(stackRowPillFor({ ...ready, mergeStatus: 'DIRTY' })).toMatchObject({ label: 'Merge conflicts', tone: 'danger' });
  });

  it('says it has unresolved comments while a conversation is open, counting them on hover', () => {
    expect(stackRowPillFor({ ...ready, conversations: { resolved: 1, total: 3 } })).toMatchObject({
      label: 'Unresolved comments',
      tone: 'attention',
      title: '2 open comment threads need resolving before this PR can merge',
    });
  });

  it('says its required checks failed, naming them, and merges over an optional one', () => {
    expect(stackRowPillFor({ ...ready, ci: pr42.ci }, ['build', failingCheck.name])).toMatchObject({ label: 'Required checks failed', tone: 'danger', title: `Failing: ${failingCheck.name}` });
    expect(stackRowPillFor({ ...ready, ci: pr42.ci }, ['build'])).toMatchObject({ label: 'Ready to merge' });
  });

  it('says changes were requested, naming by whom', () => {
    expect(stackRowPillFor({ ...ready, reviewDecision: 'CHANGES_REQUESTED', reviewers: pr42.reviewers })).toMatchObject({ label: 'Changes requested', tone: 'danger', title: 'Changes requested by jlord' });
  });

  it('says it needs reviewers, naming those asked, or that nobody is', () => {
    expect(stackRowPillFor({ ...ready, reviewDecision: 'REVIEW_REQUIRED', reviewers: pr42.reviewers })).toMatchObject({ label: 'Needs reviewers', tone: 'attention', title: 'Waiting for acme/parcs' });
    expect(stackRowPillFor({ ...ready, reviewDecision: 'REVIEW_REQUIRED', reviewers: [] })).toMatchObject({ label: 'Needs reviewers', title: 'No reviewers requested' });
  });

  it('says CI is running, counting the finished checks', () => {
    // #42's checks without the failure: 5 finished, 2 still running.
    const checks = pr42.ci.checks.filter((check) => check !== failingCheck);
    expect(stackRowPillFor({ ...ready, ci: { ...ready.ci, state: 'PENDING', checks } })).toMatchObject({ label: 'CI running', tone: 'neutral', title: '5/7 checks finished' });
  });

  it('says it is behind its base', () => {
    expect(stackRowPillFor({ ...ready, mergeStatus: 'BEHIND' })).toMatchObject({ label: 'Behind base', tone: 'attention' });
  });

  it('says branch protection blocks it', () => {
    expect(stackRowPillFor({ ...ready, mergeStatus: 'BLOCKED' })).toMatchObject({ label: 'Blocked', tone: 'neutral', title: 'Blocked by branch protection: required reviews or checks are missing' });
  });

  it('says it waits on pre-receive hooks', () => {
    expect(stackRowPillFor({ ...ready, mergeStatus: 'HAS_HOOKS' })).toMatchObject({ label: 'Waiting on hooks', tone: 'neutral' });
  });

  it('says it is ready to merge when nothing stands in the way, failing optional checks too', () => {
    expect(stackRowPillFor(ready)).toMatchObject({ label: 'Ready to merge', tone: 'success' });
    expect(stackRowPillFor({ ...ready, mergeStatus: 'UNSTABLE' })).toMatchObject({ label: 'Ready to merge', tone: 'success' });
  });

  it('shows no pill while GitHub has not said whether it can merge', () => {
    expect(stackRowPillFor({ ...ready, mergeStatus: 'UNKNOWN' })).toBeNull();
  });

  it('shows the first that applies, in the order the sidebar goes by', () => {
    // #42: changes requested, 2 of its 4 conversations open, its required e2e / portal failing, the rest running, blocked.
    expect(stackRowPillFor(pr42, pr42.requiredCheckNames)).toMatchObject({ label: 'Unresolved comments' });
    const resolved = { ...pr42, conversations: { resolved: 4, total: 4 } };
    expect(stackRowPillFor(resolved, pr42.requiredCheckNames)).toMatchObject({ label: 'Required checks failed' });
    expect(stackRowPillFor(resolved)).toMatchObject({ label: 'Changes requested' });
    expect(stackRowPillFor({ ...resolved, reviewDecision: 'REVIEW_REQUIRED', ci: { ...pr42.ci, state: 'PENDING' } })).toMatchObject({ label: 'Needs reviewers' });
    expect(stackRowPillFor({ ...resolved, reviewDecision: 'APPROVED', ci: { ...pr42.ci, state: 'PENDING' } })).toMatchObject({ label: 'CI running' });
    expect(stackRowPillFor({ ...pr42, mergeStatus: 'DIRTY' }, pr42.requiredCheckNames)).toMatchObject({ label: 'Merge conflicts' });
    expect(stackRowPillFor({ ...pr42, mergeStatus: 'DIRTY' }, pr42.requiredCheckNames, 'viewed')).toMatchObject({ label: 'Ready to merge as stack' });
    expect(stackRowPillFor({ ...pr42, isDraft: true }, pr42.requiredCheckNames, 'viewed')).toMatchObject({ label: 'Draft' });
    expect(stackRowPillFor({ ...pr42, isDraft: true, state: 'MERGED' })).toMatchObject({ label: 'Merged' });
  });
});
