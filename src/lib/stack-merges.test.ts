import { describe, expect, it } from 'vitest';
import type { CheckRunSummary, PrStages, StackReadiness } from './model';
import type { RpcMethod, RpcMethods } from './rpc';
import {
  UnansweredRequest,
  advanceStackMerge,
  isUnderWay,
  mergeStackWhenReady,
  stackMergeMessage,
  stackMergesSchema,
  whatTheStackWaitsFor,
  type GitHubThroughATab,
  type StackMerge,
  type StackMergeRequest,
} from './stack-merges';

const HOUR = 60 * 60_000;

describe('whatTheStackWaitsFor', () => {
  const waitsFor = (readiness: StackReadiness, options: Partial<{ heads: Record<string, string>; ignoreOptionalChecks: boolean; rebase: boolean; whenReady: boolean }> = {}) =>
    whatTheStackWaitsFor(readiness, { heads: { '41': 'h41', '42': 'h42' }, ignoreOptionalChecks: true, rebase: false, whenReady: false, ...options });

  it('merges once every required check has passed and GitHub says each PR can merge with those below it', () => {
    expect(waitsFor(stack())).toEqual({ kind: 'merge' });
  });

  it('waits for the required checks of every PR, counting them, and past optional ones it ignores', () => {
    const readiness = stack({ 41: [check('build', 'PENDING'), check('lint', 'PENDING')], 42: [check('build', 'SUCCESS'), check('test', 'NEUTRAL'), check('deploy-preview', 'FAILURE')] });
    expect(waitsFor(readiness)).toEqual({ kind: 'checks', requiredPassed: 2, required: 4, optionalRunning: 0 });
  });

  it('waits for optional checks too when they are not ignored, and merges once each finished successfully', () => {
    const running = stack({ 42: [check('build', 'SUCCESS'), check('test', 'SUCCESS'), check('deploy-preview', 'PENDING'), check('docs', 'SKIPPED')] });
    expect(waitsFor(running, { ignoreOptionalChecks: false })).toEqual({ kind: 'checks', requiredPassed: 4, required: 4, optionalRunning: 1 });
    expect(waitsFor(running)).toEqual({ kind: 'merge' });
    const finished = stack({ 42: [check('build', 'SUCCESS'), check('test', 'SUCCESS'), check('deploy-preview', 'NEUTRAL'), check('docs', 'SKIPPED')] });
    expect(waitsFor(finished, { ignoreOptionalChecks: false })).toEqual({ kind: 'merge' });
  });

  it('stops on a failing required check, naming it and its PR in what GitHub says of it', () => {
    const readiness = stack({ 41: [check('build', 'FAILURE', 'Failing after 2m'), check('lint', 'PENDING')] });
    expect(waitsFor(readiness)).toEqual({ kind: 'stop', reason: 'Required check "build" on #41 failed: Failing after 2m' });
    expect(waitsFor(stack({ 42: [check('build', 'SUCCESS'), check('test', 'CANCELLED')] }))).toEqual({ kind: 'stop', reason: 'Required check "test" on #42 was cancelled' });
  });

  it('stops on a failing optional check only when optional checks are not ignored', () => {
    const readiness = stack({ 42: [check('build', 'SUCCESS'), check('test', 'SUCCESS'), check('deploy-preview', 'FAILURE')] });
    expect(waitsFor(readiness)).toEqual({ kind: 'merge' });
    expect(waitsFor(readiness, { ignoreOptionalChecks: false })).toEqual({ kind: 'stop', reason: 'Optional check "deploy-preview" on #42 failed' });
  });

  it("waits for GitHub's verdict on each PR, the first not ready named with what GitHub says", () => {
    expect(waitsFor(stack({}, { 41: { status: 'BLOCKED_DOWNSTACK', mergeState: 'MERGEABLE' } }))).toEqual({ kind: 'github', number: 41, status: 'BLOCKED_DOWNSTACK' });
    expect(waitsFor(stack({}, { 42: { status: 'READY', mergeState: 'MERGEABLE_IF_STATUSES_PASS' } }))).toEqual({ kind: 'github', number: 42, status: 'READY' });
    expect(waitsFor(stack({}, { 42: { status: null, mergeState: null } }))).toEqual({ kind: 'github', number: 42, status: null });
    expect(waitsFor(stack({}, { 42: { status: 'READY', mergeState: null } }))).toEqual({ kind: 'merge' });
  });

  it('stops when a PR was merged or closed, or pushed to since the merge started', () => {
    expect(waitsFor({ ...stack(), prs: stack().prs.map((pr) => (pr.number === 41 ? { ...pr, state: 'CLOSED' } : pr)) })).toEqual({ kind: 'stop', reason: '#41 was closed meanwhile.' });
    expect(waitsFor({ ...stack(), prs: stack().prs.map((pr) => (pr.number === 42 ? { ...pr, state: 'MERGED' } : pr)) })).toEqual({ kind: 'stop', reason: '#42 was merged meanwhile.' });
    expect(waitsFor(stack(), { heads: { '41': 'h41', '42': 'older' } })).toEqual({ kind: 'stop', reason: 'New commits were pushed to #42 since the merge started. Review them, then merge again.' });
  });

  it("rebases first when asked and GitHub says the stack needs it; otherwise merges an out-of-date stack and stops on one GitHub says must be rebased, in GitHub's words", () => {
    const outdated = { ...stack(), stackSection: { kind: 'rebase-optional', baseRefName: 'main', viewerCanRebase: true } } as const;
    const diverged = { ...stack(), stackSection: { kind: 'rebase-required', baseRefName: 'main', viewerCanRebase: true } } as const;
    expect(waitsFor(outdated, { rebase: true })).toEqual({ kind: 'rebase' });
    expect(waitsFor(diverged, { rebase: true })).toEqual({ kind: 'rebase' });
    expect(waitsFor(outdated)).toEqual({ kind: 'merge' });
    expect(waitsFor(diverged)).toEqual({ kind: 'stop', reason: 'Some branches in this stack have diverged and must be rebased' });
    expect(waitsFor({ ...stack(), stackSection: { kind: 'conflicts', baseRefName: 'main', viewerCanRebase: false } }, { rebase: true })).toEqual({
      kind: 'stop',
      reason: 'This stack has conflicts that must be resolved',
    });
    expect(waitsFor({ ...stack(), mergeStatus: 'DIRTY' })).toEqual({ kind: 'stop', reason: 'This branch has conflicts that must be resolved' });
  });

  describe('merging when ready', () => {
    const whenReady = { whenReady: true } as const;

    it('merges once every required check of the open PRs has passed and GitHub says each can merge, optional checks aside', () => {
      expect(waitsFor(stack(), whenReady)).toEqual({ kind: 'merge' });
      expect(waitsFor(stack({ 42: [check('build', 'SUCCESS'), check('test', 'SUCCESS'), check('deploy-preview', 'FAILURE')] }), whenReady)).toEqual({ kind: 'merge' });
    });

    it('keeps waiting through a failing or cancelled required check, counting it as not passed', () => {
      expect(waitsFor(stack({ 41: [check('build', 'FAILURE', 'Failing after 2m'), check('lint', 'SUCCESS')] }), whenReady)).toEqual({ kind: 'checks', requiredPassed: 3, required: 4, optionalRunning: 0 });
      expect(waitsFor(stack({ 42: [check('build', 'SUCCESS'), check('test', 'CANCELLED')] }), whenReady)).toEqual({ kind: 'checks', requiredPassed: 3, required: 4, optionalRunning: 0 });
    });

    it('keeps waiting while GitHub says a PR cannot merge yet, missing reviews among the reasons', () => {
      expect(waitsFor(stack({}, { 41: { status: 'NOT_READY', mergeState: 'BLOCKED' } }), whenReady)).toEqual({ kind: 'github', number: 41, status: 'NOT_READY' });
    });

    it('keeps waiting through new commits', () => {
      expect(waitsFor(stack(), { ...whenReady, heads: { '41': 'h41', '42': 'older' } })).toEqual({ kind: 'merge' });
    });

    it('waits for a stack GitHub says must be rebased, and merges one that is only out of date as it is', () => {
      expect(waitsFor({ ...stack(), stackSection: { kind: 'rebase-required', baseRefName: 'main', viewerCanRebase: true } }, whenReady)).toEqual({ kind: 'stack-rebase' });
      expect(waitsFor({ ...stack(), stackSection: { kind: 'rebase-optional', baseRefName: 'main', viewerCanRebase: true } }, whenReady)).toEqual({ kind: 'merge' });
    });

    it('stops on a closed PR and on conflicts, in GitHub\'s words', () => {
      expect(waitsFor({ ...stack(), prs: stack().prs.map((pr) => (pr.number === 41 ? { ...pr, state: 'CLOSED' } : pr)) }, whenReady)).toEqual({ kind: 'stop', reason: '#41 was closed meanwhile.' });
      expect(waitsFor({ ...stack(), stackSection: { kind: 'conflicts', baseRefName: 'main', viewerCanRebase: false } }, whenReady)).toEqual({ kind: 'stop', reason: 'This stack has conflicts that must be resolved' });
      expect(waitsFor({ ...stack(), mergeStatus: 'DIRTY' }, whenReady)).toEqual({ kind: 'stop', reason: 'This branch has conflicts that must be resolved' });
    });

    it('merges the PRs still open, whichever merged meanwhile', () => {
      const merged41 = { ...stack({ 41: [check('build', 'FAILURE')] }, { 41: { status: null, mergeState: null } }), prs: stack().prs.map((pr) => (pr.number === 41 ? { ...pr, state: 'MERGED' as const } : pr)) };
      expect(waitsFor(merged41, whenReady)).toEqual({ kind: 'merge' });
    });
  });
});

describe('advanceStackMerge', () => {
  it('starts by looking at the stack and, with nothing to wait for, merges at once with the heads it saw', async () => {
    const github = gitHub({ 'pr.fetchStackReadiness': () => stack() });
    const next = await advanceStackMerge(merge(), github, START);
    expect(next.step).toEqual({ kind: 'merging', sentAt: null });
    expect(next.heads).toEqual({ '41': 'h41', '42': 'h42' });
    expect(github.asked).toEqual([['pr.fetchStackReadiness', { repo: REPO, number: 42, prs: [41, 42] }]]);
  });

  it('stops before anything is sent when the PR it merges from has a newer head than the viewer saw', async () => {
    const github = gitHub({ 'pr.fetchStackReadiness': () => stack() });
    const next = await advanceStackMerge(merge({ expectedHeadOid: 'older' }), github, START);
    expect(next.step).toEqual({ kind: 'stopped', reason: 'New commits were pushed since this page loaded. Reload and review them before merging.' });
  });

  it('rebases an out-of-date stack first when asked to, once, then waits for the checks of the new heads', async () => {
    const outdated = { ...stack(), stackSection: { kind: 'rebase-optional', baseRefName: 'main', viewerCanRebase: true } } as const;
    const github = gitHub({ 'pr.fetchStackReadiness': () => outdated, 'pr.fetchHeader': () => header(), 'pr.rebaseStack': () => ({ complete: true }) });
    const rebasing = await advanceStackMerge(merge(), github, START);
    expect(rebasing.step).toEqual({ kind: 'rebasing', sent: false });
    const rebased = await advanceStackMerge(rebasing, github, START + 1000);
    expect(rebased.step).toEqual({ kind: 'waiting', for: null });
    expect(rebased.heads).toBeNull();
    expect(github.asked.map(([method]) => method)).toEqual(['pr.fetchStackReadiness', 'pr.fetchHeader', 'pr.rebaseStack']);
    expect(github.asked[2]).toEqual(['pr.rebaseStack', { prId: 'PR_42' }]);
    // Unticked, the same stack merges as it is.
    const asIs = await advanceStackMerge(merge({ rebaseFirst: false }), github, START);
    expect(asIs.step).toEqual({ kind: 'merging', sentAt: null });
  });

  it('follows a rebase GitHub is still at, and stops on one it stopped, in its words', async () => {
    const github = gitHub({ 'pr.fetchHeader': () => header(), 'pr.rebaseStack': () => ({ complete: false }), 'pr.followStackRebase': () => ({ complete: false }) });
    const sent = await advanceStackMerge(merge({ step: { kind: 'rebasing', sent: false } }), github, START);
    expect(sent.step).toEqual({ kind: 'rebasing', sent: true });
    const still = await advanceStackMerge(sent, github, START + 30_000);
    expect(still.step).toEqual({ kind: 'rebasing', sent: true });
    expect(github.asked.map(([method]) => method)).toEqual(['pr.fetchHeader', 'pr.rebaseStack', 'pr.fetchHeader', 'pr.followStackRebase']);
    const conflicted = gitHub({
      'pr.fetchHeader': () => header(),
      'pr.followStackRebase': () => {
        throw new Error('Rebasing was stopped due to merge conflicts. Resolve the merge conflicts in pull request #41, then try to rebase this stack again.');
      },
    });
    expect((await advanceStackMerge(sent, conflicted, START + 60_000)).step).toEqual({
      kind: 'stopped',
      reason: 'Rebasing was stopped due to merge conflicts. Resolve the merge conflicts in pull request #41, then try to rebase this stack again.',
    });
  });

  it('waits while checks run, saying how far they got, then merges once they pass', async () => {
    let checks: StackReadiness = stack({ 41: [check('build', 'PENDING'), check('lint', 'SUCCESS')] });
    const github = gitHub({ 'pr.fetchStackReadiness': () => checks });
    const waiting = await advanceStackMerge(merge({ step: { kind: 'waiting', for: null } }), github, START);
    expect(waiting.step).toEqual({ kind: 'waiting', for: { kind: 'checks', requiredPassed: 3, required: 4, optionalRunning: 0 } });
    expect(waiting.heads).toEqual({ '41': 'h41', '42': 'h42' });
    checks = stack();
    expect((await advanceStackMerge(waiting, github, START + 30_000)).step).toEqual({ kind: 'merging', sentAt: null });
  });

  it('stops a merge whose required check failed, or whose PR someone pushed to, while it waited', async () => {
    const failing = gitHub({ 'pr.fetchStackReadiness': () => stack({ 42: [check('build', 'SUCCESS'), check('test', 'FAILURE')] }) });
    const waiting = merge({ heads: { '41': 'h41', '42': 'h42' }, step: { kind: 'waiting', for: null } });
    expect((await advanceStackMerge(waiting, failing, START)).step).toEqual({ kind: 'stopped', reason: 'Required check "test" on #42 failed' });
    const pushed = gitHub({ 'pr.fetchStackReadiness': () => ({ ...stack(), prs: stack().prs.map((pr) => (pr.number === 41 ? { ...pr, headOid: 'newer' } : pr)) }) });
    expect((await advanceStackMerge(waiting, pushed, START)).step).toEqual({
      kind: 'stopped',
      reason: 'New commits were pushed to #41 since the merge started. Review them, then merge again.',
    });
  });

  it('keeps its step when GitHub could not be asked, saying why, and stops after six hours of waiting', async () => {
    const unreachable = gitHub({
      'pr.fetchStackReadiness': () => {
        throw new UnansweredRequest('No github.com tab could ask GitHub; CarbonLayer tries again in a moment', false);
      },
    });
    const waiting = merge({ step: { kind: 'waiting', for: { kind: 'checks', requiredPassed: 1, required: 2, optionalRunning: 0 } } });
    expect(await advanceStackMerge(waiting, unreachable, START)).toEqual({ ...waiting, trouble: 'No github.com tab could ask GitHub; CarbonLayer tries again in a moment' });
    expect((await advanceStackMerge(waiting, unreachable, START + 6 * HOUR + 1)).step).toEqual({
      kind: 'stopped',
      reason: 'CarbonLayer stopped waiting after 6 hours: the stack still could not merge.',
    });
  });

  it('merges from the PR at the top with the method, the commit written and the head it waited for, and is merged once GitHub says so', async () => {
    let state: PrStages['header']['state'] = 'OPEN';
    const github = gitHub({
      'pr.fetchHeader': () => header({ state }),
      'pr.merge': () => {
        state = 'MERGED';
      },
    });
    const commit = { commitTitle: 'Merge the stack', commitMessage: 'Two PRs' };
    const next = await advanceStackMerge(merge({ method: 'MERGE', commit, heads: { '41': 'h41', '42': 'h42' }, step: { kind: 'merging', sentAt: null } }), github, START);
    expect(next.step).toEqual({ kind: 'merged' });
    expect(github.asked).toEqual([
      ['pr.fetchHeader', { repo: REPO, number: 42 }],
      ['pr.merge', { prId: 'PR_42', method: 'MERGE', expectedHeadOid: 'h42', commit }],
      ['pr.fetchHeader', { repo: REPO, number: 42 }],
    ]);
  });

  it("stops on a merge GitHub refused, in its words; one whose answer was lost is followed by the PR's state", async () => {
    const merging = merge({ heads: { '41': 'h41', '42': 'h42' }, step: { kind: 'merging', sentAt: null } });
    const refused = gitHub({
      'pr.fetchHeader': () => header(),
      'pr.merge': () => {
        throw new Error('Pull request is not mergeable');
      },
    });
    expect((await advanceStackMerge(merging, refused, START)).step).toEqual({ kind: 'stopped', reason: 'Pull request is not mergeable' });
    const lost = gitHub({
      'pr.fetchHeader': () => header(),
      'pr.merge': () => {
        throw new UnansweredRequest('The github.com tab went away before GitHub answered pr.merge', true);
      },
    });
    const unknown = await advanceStackMerge(merging, lost, START);
    expect(unknown.step).toEqual({ kind: 'merging', sentAt: START });
    expect(unknown.trouble).toBe('The github.com tab went away before GitHub answered pr.merge');
    // Never sent: sent again next time.
    const notSent = gitHub({
      'pr.fetchHeader': () => header(),
      'pr.merge': () => {
        throw new UnansweredRequest('No github.com tab could ask GitHub; CarbonLayer tries again in a moment', false);
      },
    });
    expect((await advanceStackMerge(merging, notSent, START)).step).toEqual({ kind: 'merging', sentAt: null });
    // Sent: merged once GitHub says so, given up on after ten minutes, and never sent twice.
    const open = gitHub({ 'pr.fetchHeader': () => header() });
    expect((await advanceStackMerge(unknown, open, START + 60_000)).step).toEqual({ kind: 'merging', sentAt: START });
    expect((await advanceStackMerge(unknown, open, START + 11 * 60_000)).step).toEqual({
      kind: 'stopped',
      reason: 'GitHub had not merged the stack 10 minutes after CarbonLayer asked it to. See the pull request on GitHub.',
    });
    expect(open.asked.map(([method]) => method)).toEqual(['pr.fetchHeader', 'pr.fetchHeader']);
    expect((await advanceStackMerge(unknown, gitHub({ 'pr.fetchHeader': () => header({ state: 'MERGED' }) }), START + 60_000)).step).toEqual({ kind: 'merged' });
  });

  describe('merging when ready', () => {
    it('keeps waiting through a failing check and new commits, then merges from the PR at the top with the heads it saw last and the commit GitHub proposes', async () => {
      let readiness: StackReadiness = stack({ 41: [check('build', 'FAILURE'), check('lint', 'SUCCESS')] });
      let state: PrStages['header']['state'] = 'OPEN';
      const github = gitHub({
        'pr.fetchStackReadiness': () => readiness,
        'pr.fetchHeader': () => header({ state, headOid: 'h42-pushed' }),
        'pr.merge': () => {
          state = 'MERGED';
        },
      });
      // Armed on a head the stack has since moved on from: no matter.
      const failing = await advanceStackMerge(merge({ whenReady: true, expectedHeadOid: 'older', rebaseFirst: false }), github, START);
      expect(failing.step).toEqual({ kind: 'waiting', for: { kind: 'checks', requiredPassed: 3, required: 4, optionalRunning: 0 }, lookedAt: START, unchangedSince: START });
      const stillFailing = stack({ 41: [check('build', 'FAILURE'), check('lint', 'SUCCESS')] });
      readiness = { ...stillFailing, prs: stillFailing.prs.map((pr) => (pr.number === 42 ? { ...pr, headOid: 'h42-pushed' } : pr)) };
      const pushed = await advanceStackMerge(failing, github, START + 30_000);
      expect(pushed.step).toEqual({ kind: 'waiting', for: { kind: 'checks', requiredPassed: 3, required: 4, optionalRunning: 0 }, lookedAt: START + 30_000, unchangedSince: START + 30_000 });
      expect(pushed.heads).toEqual({ '41': 'h41', '42': 'h42-pushed' });
      readiness = { ...stack(), prs: stack().prs.map((pr) => (pr.number === 42 ? { ...pr, headOid: 'h42-pushed' } : pr)) };
      const ready = await advanceStackMerge(pushed, github, START + 60_000);
      expect(ready.step).toEqual({ kind: 'merging', sentAt: null });
      expect((await advanceStackMerge(ready, github, START + 60_000)).step).toEqual({ kind: 'merged' });
      expect(github.asked.filter(([method]) => method === 'pr.merge')).toEqual([['pr.merge', { prId: 'PR_42', method: 'SQUASH', expectedHeadOid: 'h42-pushed' }]]);
    });

    it('keeps waiting for missing reviews and a stack GitHub says must be rebased, with no time cap, and never rebases it', async () => {
      const blocked = gitHub({ 'pr.fetchStackReadiness': () => stack({}, { 42: { status: 'NOT_READY', mergeState: 'BLOCKED' } }) });
      const waiting = merge({ whenReady: true, rebaseFirst: false, step: { kind: 'waiting', for: null } });
      expect((await advanceStackMerge(waiting, blocked, START + 7 * 24 * HOUR)).step).toMatchObject({ kind: 'waiting', for: { kind: 'github', number: 42, status: 'NOT_READY' } });
      const diverged = gitHub({ 'pr.fetchStackReadiness': () => ({ ...stack(), stackSection: { kind: 'rebase-required', baseRefName: 'main', viewerCanRebase: true } }) });
      expect((await advanceStackMerge(waiting, diverged, START)).step).toMatchObject({ kind: 'waiting', for: { kind: 'stack-rebase' } });
      expect(diverged.asked.map(([method]) => method)).toEqual(['pr.fetchStackReadiness']);
    });

    it('stops on a closed PR, conflicts and a merge GitHub refused, in its words', async () => {
      const waiting = merge({ whenReady: true, rebaseFirst: false, step: { kind: 'waiting', for: null } });
      const closed = gitHub({ 'pr.fetchStackReadiness': () => ({ ...stack(), prs: stack().prs.map((pr) => (pr.number === 41 ? { ...pr, state: 'CLOSED' } : pr)) }) });
      expect((await advanceStackMerge(waiting, closed, START)).step).toEqual({ kind: 'stopped', reason: '#41 was closed meanwhile.' });
      const conflicted = gitHub({ 'pr.fetchStackReadiness': () => ({ ...stack(), stackSection: { kind: 'conflicts', baseRefName: 'main', viewerCanRebase: false } }) });
      expect((await advanceStackMerge(waiting, conflicted, START)).step).toEqual({ kind: 'stopped', reason: 'This stack has conflicts that must be resolved' });
      const refused = gitHub({
        'pr.fetchHeader': () => header(),
        'pr.merge': () => {
          throw new Error('Pull request is not mergeable');
        },
      });
      const merging = merge({ whenReady: true, rebaseFirst: false, heads: { '41': 'h41', '42': 'h42' }, step: { kind: 'merging', sentAt: null } });
      expect((await advanceStackMerge(merging, refused, START)).step).toEqual({ kind: 'stopped', reason: 'Pull request is not mergeable' });
    });

    it('looks at the stack again when a merge was refused because its PR was pushed to after it looked', async () => {
      let headOid = 'h42';
      const github = gitHub({
        'pr.fetchHeader': () => header({ headOid }),
        'pr.merge': () => {
          headOid = 'h42-pushed';
          throw new Error('New commits were pushed since this page loaded. Reload and review them before merging.');
        },
      });
      const merging = merge({ whenReady: true, rebaseFirst: false, heads: { '41': 'h41', '42': 'h42' }, step: { kind: 'merging', sentAt: null } });
      expect((await advanceStackMerge(merging, github, START)).step).toEqual({ kind: 'waiting', for: null });
    });

    it('looks again after a quarter of the time the stack has waited unchanged, every 30 s at first and every 5 minutes at most', async () => {
      const github = gitHub({ 'pr.fetchStackReadiness': () => stack({}, { 42: { status: 'NOT_READY', mergeState: 'BLOCKED' } }) });
      const looked = (waited: number) =>
        merge({ whenReady: true, rebaseFirst: false, heads: { '41': 'h41', '42': 'h42' }, step: { kind: 'waiting', for: { kind: 'github', number: 42, status: 'NOT_READY' }, lookedAt: START + waited, unchangedSince: START } });
      const lookAfter = async (waited: number, after: number) => {
        const before = looked(waited);
        return (await advanceStackMerge(before, github, START + waited + after)) !== before;
      };
      // A minute unchanged: every 30 s, the alarm's own pace, give or take its 5 s.
      expect([await lookAfter(60_000, 20_000), await lookAfter(60_000, 26_000), await lookAfter(60_000, 30_000)]).toEqual([false, true, true]);
      // Eight minutes: every 2 minutes.
      expect([await lookAfter(8 * 60_000, 60_000), await lookAfter(8 * 60_000, 2 * 60_000)]).toEqual([false, true]);
      // A day: every 5 minutes.
      expect([await lookAfter(24 * HOUR, 4 * 60_000), await lookAfter(24 * HOUR, 5 * 60_000)]).toEqual([false, true]);
      // One not due asks GitHub nothing.
      const asked = github.asked.length;
      await lookAfter(24 * HOUR, 60_000);
      expect(github.asked.length).toBe(asked);
    });

    it('counts the wait as unchanged while the stack waits for the same thing at the same heads, and from the last change otherwise', async () => {
      let readiness = stack({}, { 42: { status: 'NOT_READY', mergeState: 'BLOCKED' } });
      const github = gitHub({ 'pr.fetchStackReadiness': () => readiness });
      const waiting = merge({ whenReady: true, rebaseFirst: false, heads: { '41': 'h41', '42': 'h42' }, step: { kind: 'waiting', for: { kind: 'github', number: 42, status: 'NOT_READY' }, lookedAt: START + HOUR, unchangedSince: START } });
      const same = await advanceStackMerge(waiting, github, START + HOUR + 5 * 60_000);
      expect(same.step).toMatchObject({ lookedAt: START + HOUR + 5 * 60_000, unchangedSince: START });
      readiness = stack({}, { 41: { status: 'NOT_READY', mergeState: 'BLOCKED' } });
      expect((await advanceStackMerge(same, github, START + 2 * HOUR)).step).toMatchObject({ for: { kind: 'github', number: 41 }, unchangedSince: START + 2 * HOUR });
      const blocked = stack({}, { 42: { status: 'NOT_READY', mergeState: 'BLOCKED' } });
      readiness = { ...blocked, prs: blocked.prs.map((pr) => (pr.number === 41 ? { ...pr, headOid: 'h41-pushed' } : pr)) };
      expect((await advanceStackMerge(same, github, START + 2 * HOUR)).step).toMatchObject({ for: { kind: 'github', number: 42 }, unchangedSince: START + 2 * HOUR });
    });
  });

  it('leaves a merge that ended as it is', async () => {
    const github = gitHub({});
    const stopped = merge({ step: { kind: 'stopped', reason: 'Cancelled' } });
    expect(await advanceStackMerge(stopped, github, START + 7 * HOUR)).toBe(stopped);
    expect(github.asked).toEqual([]);
    expect([isUnderWay(stopped), isUnderWay(merge({ step: { kind: 'merged' } })), isUnderWay(merge())]).toEqual([false, false, true]);
  });
});

describe('mergeStackWhenReady', () => {
  const STACK = { repo: REPO, number: 42, prs: merge().prs, trunk: 'main', method: 'MERGE', expectedHeadOid: 'h42' } as const;
  /** The page's data source as far as "Merge when ready" goes: GitHub's answer to auto-merge, and the stack merges started. */
  const source = (setAutoMerge: () => Promise<void>) => {
    const started: StackMergeRequest[] = [];
    const asked: Array<[string, boolean, string]> = [];
    return {
      started,
      asked,
      setAutoMerge: async (prId: string, enabled: boolean, method: string) => {
        asked.push([prId, enabled, method]);
        await setAutoMerge();
      },
      startStackMerge: async (request: StackMergeRequest) => {
        started.push(request);
      },
    };
  };

  it("leaves the stack to GitHub's auto-merge once GitHub accepts it", async () => {
    const page = source(async () => {});
    expect(await mergeStackWhenReady('PR_42', STACK, page)).toBe('github');
    expect(page.asked).toEqual([['PR_42', true, 'MERGE']]);
    expect(page.started).toEqual([]);
  });

  it("merges the stack itself when ready, by GitHub's merge rules, where GitHub says the repository has no stack auto-merge", async () => {
    for (const refusal of ['Stack auto-merge is not enabled.', 'stack auto-merge is NOT enabled']) {
      const page = source(async () => {
        throw new Error(refusal);
      });
      expect(await mergeStackWhenReady('PR_42', STACK, page)).toBe('carbonlayer');
      expect(page.started).toEqual([{ ...STACK, ignoreOptionalChecks: true, rebaseFirst: false, whenReady: true }]);
    }
  });

  it('passes any other refusal on, starting nothing', async () => {
    const page = source(async () => {
      throw new Error('Pull request is in clean status');
    });
    await expect(mergeStackWhenReady('PR_42', STACK, page)).rejects.toThrow('Pull request is in clean status');
    expect(page.started).toEqual([]);
  });
});

describe('what the page and the background send each other and keep', () => {
  it('reads a start and a drop, and refuses a request of another shape, saying what differs', () => {
    const { id, startedAt, heads, step, trouble, ...request } = merge();
    expect(stackMergeMessage.parse({ kind: 'carbonlayer-start-stack-merge', request: { ...request, extra: 1 } })).toEqual({ kind: 'carbonlayer-start-stack-merge', request });
    expect(stackMergeMessage.parse({ kind: 'carbonlayer-drop-stack-merge', id: 'm-1' })).toEqual({ kind: 'carbonlayer-drop-stack-merge', id: 'm-1' });
    expect(() => stackMergeMessage.parse({ kind: 'carbonlayer-start-stack-merge', request: { ...request, method: 'FAST_FORWARD' } })).toThrow(/method/);
    expect(() => stackMergeMessage.parse({ kind: 'carbonlayer-start-stack-merge', request: { ...request, rebaseFirst: undefined } })).toThrow(/rebaseFirst/);
    expect(() => stackMergeMessage.parse({ kind: 'carbonlayer-start-stack-merge', request: { ...request, whenReady: undefined } })).toThrow(/whenReady/);
    expect(stackMergeMessage.safeParse({ kind: 'carbonlayer-merge-everything' }).success).toBe(false);
    expect([id, startedAt, heads, step, trouble]).toEqual(['m-1', START, null, { kind: 'starting' }, null]);
  });

  it('keeps stack merges of the shape this build writes, and refuses others', () => {
    const kept = [
      merge({ step: { kind: 'waiting', for: { kind: 'github', number: 41, status: 'NOT_READY' } } }),
      merge({ whenReady: true, step: { kind: 'waiting', for: { kind: 'stack-rebase' }, lookedAt: START, unchangedSince: START } }),
    ];
    expect(stackMergesSchema.parse(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    expect(stackMergesSchema.safeParse([{ ...merge(), step: { kind: 'paused' } }]).success).toBe(false);
  });
});

const START = Date.parse('2026-10-19T12:00:00Z');
const REPO = { owner: 'acme', name: 'widgets' };

/** A stack merge of #41 and #42, from #42, just started, unless `changes` say otherwise. */
function merge(changes: Partial<StackMerge> = {}): StackMerge {
  return {
    id: 'm-1',
    repo: REPO,
    number: 42,
    prs: [
      { number: 41, title: 'Add the PARCS client' },
      { number: 42, title: 'Add zone switching to the PARCS adapter' },
    ],
    trunk: 'main',
    method: 'SQUASH',
    expectedHeadOid: 'h42',
    ignoreOptionalChecks: true,
    rebaseFirst: true,
    whenReady: false,
    startedAt: START,
    heads: null,
    step: { kind: 'starting' },
    trouble: null,
    ...changes,
  };
}

/**
 * #41 and #42 open at heads h41 and h42, every check passed (build and lint required on #41, build and test on #42) and
 * GitHub saying each can merge, unless `checks` or `verdicts` say otherwise; the merge box says nothing of the branches.
 */
function stack(checks: Partial<Record<41 | 42, CheckRunSummary[]>> = {}, verdicts: Partial<Record<41 | 42, StackReadiness['prs'][number]['verdict']>> = {}): StackReadiness {
  const pr = (number: 41 | 42, required: string[]) => {
    const own = checks[number] ?? required.map((name) => check(name, 'SUCCESS'));
    return {
      number,
      state: 'OPEN' as const,
      headOid: `h${number}`,
      ci: { state: 'SUCCESS' as const, checks: own, counts: { success: own.length, failure: 0, pending: 0, other: 0 } },
      requiredCheckNames: required,
      verdict: verdicts[number] ?? { status: 'READY', mergeState: 'MERGEABLE' },
    };
  };
  return { mergeStatus: 'CLEAN', stackSection: null, prs: [pr(41, ['build', 'lint']), pr(42, ['build', 'test'])] };
}

function check(name: string, state: CheckRunSummary['state'], description: string | null = null): CheckRunSummary {
  return { name, state, url: null, description, group: null, startedAt: null, completedAt: null, runId: null };
}

/** The header stage of #42, open, unless `changes` say otherwise. */
function header(changes: Partial<PrStages['header']> = {}): PrStages['header'] {
  return {
    id: 'PR_42',
    repo: REPO,
    number: 42,
    title: 'Add zone switching to the PARCS adapter',
    url: 'https://github.com/acme/widgets/pull/42',
    author: { login: 'mona', avatarUrl: '', url: 'https://github.com/mona' },
    state: 'OPEN',
    isDraft: false,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-19T00:00:00Z',
    mergedAt: null,
    headRefName: 'mona/zone-switching',
    baseRefName: 'mona/parcs-client',
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    commentCount: 0,
    nativeStack: { position: 2, size: 2 },
    bodyHtml: '',
    descriptionReactions: [],
    descriptionUrl: null,
    headOid: 'h42',
    viewerCanUpdate: true,
    viewerDidAuthor: true,
    viewerLogin: 'mona',
    stackSource: 'native',
    ...changes,
  };
}

/**
 * GitHub through a tab, answering each method from `answers` (a method without an answer fails the test) and recording
 * what was asked, in order.
 */
function gitHub(answers: { [M in RpcMethod]?: (args: RpcMethods[M]['args']) => RpcMethods[M]['result'] }): GitHubThroughATab & { asked: Array<[RpcMethod, unknown]> } {
  const asked: Array<[RpcMethod, unknown]> = [];
  return {
    asked,
    async ask<M extends RpcMethod>(method: M, args: RpcMethods[M]['args']): Promise<RpcMethods[M]['result']> {
      asked.push([method, args]);
      const answer: ((args: RpcMethods[M]['args']) => RpcMethods[M]['result']) | undefined = answers[method];
      if (!answer) throw new Error(`Not expected: ${method}`);
      return answer(args);
    },
  };
}
