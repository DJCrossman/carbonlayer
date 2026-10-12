import { describe, expect, it } from 'vitest';
import { prFixtures } from '../fixtures/pr';
import type { PrDetail } from '../lib/model';
import { nextActionFor } from './next-action';

const pr41 = prFixtures.find((pr) => pr.number === 41)!;
const pr42 = prFixtures.find((pr) => pr.number === 42)!;

// #41 is the bottom of its stack, approved, green and clean: nothing stands in its way.
const ready: PrDetail = pr41;
const failingCheck = pr42.ci.checks.find((check) => check.state === 'FAILURE')!;

describe('nextActionFor', () => {
  it('is ready to merge when nothing blocks the PR', () => {
    expect(nextActionFor(ready)).toMatchObject({ kind: 'ready', tone: 'success', title: 'Ready to merge' });
  });

  it.each([
    ['merged', { state: 'MERGED' }, 'Merged'],
    ['closed', { state: 'CLOSED' }, 'Closed'],
    ['draft', { isDraft: true }, 'Draft'],
    ['conflicts', { mergeStatus: 'DIRTY' }, 'Conflicts with main'],
    ['unresolved', { unresolvedThreadCount: 2 }, 'Unresolved comments'],
    ['checks-failed', { ci: { ...pr42.ci } }, 'Checks failed'],
    ['changes-requested', { reviewDecision: 'CHANGES_REQUESTED', reviewers: pr42.reviewers }, 'Changes requested by jlord'],
    ['review-required', { reviewDecision: 'REVIEW_REQUIRED', reviewers: pr42.reviewers }, 'Waiting for review'],
    ['behind', { mergeStatus: 'BEHIND' }, 'Behind main'],
    ['blocked', { mergeStatus: 'BLOCKED' }, 'Blocked by branch protection'],
  ] as const)('names %s', (kind, overrides, title) => {
    expect(nextActionFor({ ...ready, ...overrides } as PrDetail)).toMatchObject({ kind, title });
  });

  it('counts finished checks while they run', () => {
    // #42's checks without the failure: 6 finished, 2 still running.
    const checks = pr42.ci.checks.filter((check) => check !== failingCheck);
    const action = nextActionFor({ ...ready, ci: { ...ready.ci, state: 'PENDING', checks } });
    expect(action).toMatchObject({ kind: 'checks-running', title: 'Checks running · 5/7' });
  });

  it('names the first failing check and the pending reviewers', () => {
    expect(nextActionFor({ ...ready, ci: pr42.ci })).toMatchObject({ detail: 'e2e / portal' });
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
