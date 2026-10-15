import { assert, describe, expect, it } from 'vitest';
import { prFixtures } from '../fixtures/pr';
import type { PrDetail } from '../lib/model';
import { nextActionFor } from './next-action';

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
    expect(nextActionFor(ready)).toMatchObject({ kind: 'ready', tone: 'success', title: 'Ready to merge', detail: null });
  });

  it('merges over a failing optional check, like GitHub and Graphite, and says so', () => {
    const optional = { ...ready, ci: { ...pr42.ci }, requiredCheckNames: ready.requiredCheckNames.filter((name) => name !== failingCheck.name), mergeStatus: 'UNSTABLE' as const };
    expect(nextActionFor(optional)).toMatchObject({ kind: 'ready', detail: `An optional check is failing: ${failingCheck.name}` });
  });

  it.each<[string, Partial<PrDetail>, string]>([
    ['merged', { state: 'MERGED' }, 'Merged'],
    ['closed', { state: 'CLOSED' }, 'Closed'],
    ['draft', { isDraft: true }, 'Draft'],
    ['conflicts', { mergeStatus: 'DIRTY' }, 'Conflicts with main'],
    ['unresolved', { unresolvedThreadCount: 2 }, 'Unresolved comments'],
    ['checks-failed', { ci: { ...pr42.ci }, requiredCheckNames: [failingCheck.name] }, 'Checks failed'],
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

  it('names the failing required check and the pending reviewers', () => {
    expect(nextActionFor({ ...ready, ci: pr42.ci, requiredCheckNames: ['e2e / portal'] })).toMatchObject({ detail: 'e2e / portal' });
    expect(nextActionFor({ ...ready, reviewDecision: 'REVIEW_REQUIRED', reviewers: pr42.reviewers })).toMatchObject({ detail: 'acme/parcs' });
    expect(nextActionFor({ ...ready, unresolvedThreadCount: 1 })).toMatchObject({ detail: '1 thread needs resolving' });
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
    expect(nextActionFor({ ...pr42, mergeStatus: 'DIRTY' })).toMatchObject({ kind: 'conflicts', title: 'Conflicts with mona/parcs-client' });
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
