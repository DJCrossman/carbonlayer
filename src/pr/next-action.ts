// The single next step a pull request is waiting on, as shown in the sidebar's action card, and in the same order the one
// pill the stack card's row shows for each PR in the stack; and which of the stack's PRs the card draws rows for.

import type { PrDetail, PrStage, PrSummary, Stack, StackEntry } from '../lib/model';
import type { IconName } from '../ui/Icon';

/**
 * What stands between this PR and being merged, most fundamental first: its state, then conflicts, what GitHub says of
 * its native stack's branches, the stack below it, open conversations, required checks, reviews, and finally branch
 * protection. When nothing does, it is ready to merge, and in a GitHub-native stack that GitHub can merge from the
 * bottom up to it, ready to merge as a stack: GitHub's verdict then stands for the open PRs below it. A draft is a draft,
 * as Graphite's sidebar has it, unless a required check failed, and stays one while the checks have not arrived. While a
 * stage that a step depends on has not arrived (`unknown`), the answer stops at that step: "Checking mergeability…".
 */
export function nextActionFor(pr: PrDetail, unknown: readonly PrStage[] = []): NextAction {
  if (pr.state === 'MERGED') return { kind: 'merged', tone: 'done', title: 'Merged', detail: null };
  // A closed PR's status card says who closed it without merging, so its next step says no more, as Graphite's.
  if (pr.state === 'CLOSED') return { kind: 'closed', tone: 'neutral', title: 'Closed', detail: null };
  // Only a required check's failure stands in the way: GitHub merges over optional ones, and so does Graphite.
  const required = pr.ci.checks.filter((check) => pr.requiredCheckNames.includes(check.name));
  const requiredFailing = required.filter((check) => check.state === 'FAILURE').length;
  const checksFailed: NextAction = {
    kind: 'checks-failed',
    tone: 'danger',
    title: 'Required checks failed',
    detail: `${requiredFailing} of ${required.length} required ${required.length === 1 ? 'check' : 'checks'} failed`,
  };
  // Graphite's sidebar shows a draft no next step but a required check that failed, and was not seen naming anything else
  // in a draft's way; Ready for review is the top bar's and the ⋯ menu's.
  if (pr.isDraft || pr.mergeStatus === 'DRAFT') {
    if (requiredFailing > 0 && !unknown.includes('checks')) return checksFailed;
    return { kind: 'draft', tone: 'neutral', title: 'Draft', detail: 'Mark ready for review when it is done.' };
  }
  const checking: NextAction = { kind: 'checking', tone: 'neutral', title: 'Checking mergeability…', detail: null };
  if (unknown.includes('mergeBox')) return checking;
  if (pr.mergeStatus === 'DIRTY') {
    return { kind: 'conflicts', tone: 'danger', title: 'Merge conflicts', detail: "This PR can't be merged because of a conflict with the base branch" };
  }
  // GitHub's merge box sections about the stack's branches that keep it from merging, or turning on auto-merge, in its
  // words; a stack behind its base merges all the same.
  const stackSection = pr.stackSection?.kind;
  if (stackSection === 'current-conflicts' || stackSection === 'conflicts') {
    return {
      kind: 'stack-conflicts',
      tone: 'danger',
      title: stackSection === 'current-conflicts' ? 'This branch has conflicts that must be resolved' : 'This stack has conflicts that must be resolved',
      detail: 'Use the command line to resolve conflicts within the stack before continuing.',
    };
  }
  if (stackSection === 'rebase-required') {
    return {
      kind: 'stack-rebase',
      tone: 'attention',
      title: 'Some branches in this stack have diverged and must be rebased',
      detail: 'Rebase this stack to restore a linear commit history across its branches.',
    };
  }
  if (unknown.includes('stack')) return checking;
  // The PR closest to trunk that is still open has to merge first, unless GitHub can merge it and this one as a stack; only
  // this PR's own line counts, never a fork off it.
  const downstack = pr.stack.entries.slice(0, pr.stack.currentIndex).find((entry) => entry.state === 'OPEN');
  const asStack = stackToMerge(pr.stack);
  if (downstack && !asStack) {
    return { kind: 'downstack', tone: 'attention', title: `Waiting on downstack · #${downstack.number}`, detail: downstack.title, pr: downstack };
  }
  if (unknown.includes('threads')) return checking;
  if (pr.unresolvedThreadCount > 0) {
    const count = pr.unresolvedThreadCount;
    return {
      kind: 'unresolved',
      tone: 'attention',
      title: 'Unresolved comments',
      detail: `${count} open comment ${count === 1 ? 'thread needs' : 'threads need'} resolving before this PR can merge`,
    };
  }
  if (unknown.includes('checks')) return checking;
  const failing = pr.ci.checks.filter((check) => check.state === 'FAILURE');
  if (requiredFailing > 0) return checksFailed;
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    const requester = pr.reviewers.find((reviewer) => reviewer.state === 'CHANGES_REQUESTED');
    return {
      kind: 'changes-requested',
      tone: 'danger',
      title: requester ? `Changes requested by ${requester.user.login}` : 'Changes requested',
      detail: null,
    };
  }
  if (pr.reviewDecision === 'REVIEW_REQUIRED') {
    const pending = pr.reviewers.filter((reviewer) => reviewer.state === 'PENDING').map((reviewer) => reviewer.user.login);
    if (pending.length > 0) return { kind: 'review-required', tone: 'attention', title: 'Waiting for review', detail: pending.join(', ') };
    // Asked of nobody, a review is required by the branch rules alone, so a count of none is the merge box not saying.
    const approvals = pr.reviewers.filter((reviewer) => reviewer.state === 'APPROVED').length;
    const requiredApprovals = pr.numReviewsRequired;
    return {
      kind: 'needs-reviewers',
      tone: 'attention',
      title: 'Needs more reviewers',
      detail: requiredApprovals
        ? `Branch rules require ${requiredApprovals} ${requiredApprovals === 1 ? 'approval' : 'approvals'} (${approvals} so far) and no reviewers are requested`
        : `An approval is required (${approvals} so far) and no reviewers are requested`,
    };
  }
  if (pr.ci.state === 'PENDING') {
    const finished = pr.ci.checks.filter((check) => check.state !== 'PENDING').length;
    return { kind: 'checks-running', tone: 'attention', title: `Checks running · ${finished}/${pr.ci.checks.length}`, detail: null };
  }
  if (pr.mergeStatus === 'BEHIND') {
    return { kind: 'behind', tone: 'attention', title: `Behind ${pr.baseRefName}`, detail: 'Update the branch on GitHub.' };
  }
  if (pr.mergeStatus === 'BLOCKED') return { kind: 'blocked', tone: 'danger', title: 'Blocked by branch protection', detail: null };
  if (asStack) return { kind: 'ready-as-stack', tone: 'success', title: 'Ready to merge as stack', detail: 'This PR and all of its downstack PRs can be merged', prs: asStack };
  return {
    kind: 'ready',
    tone: 'success',
    title: 'Ready to merge',
    detail: failing.length > 0 ? `${failing.length === 1 ? 'An optional check is' : `${failing.length} optional checks are`} failing: ${failing.map((check) => check.name).join(', ')}` : 'All CI and approval requirements have been met',
  };
}

export type NextAction = {
  tone: 'success' | 'danger' | 'attention' | 'neutral' | 'done';
  title: string;
  detail: string | null;
} & (
  | {
      kind:
        | 'merged'
        | 'closed'
        | 'draft'
        | 'checking'
        | 'conflicts'
        | 'stack-conflicts'
        | 'stack-rebase'
        | 'unresolved'
        | 'checks-failed'
        | 'changes-requested'
        | 'review-required'
        | 'needs-reviewers'
        | 'checks-running'
        | 'behind'
        | 'blocked'
        | 'ready';
    }
  | { kind: 'downstack'; pr: StackEntry }
  | { kind: 'ready-as-stack'; prs: StackEntry[] }
);

/** The one pill a row of the stack card shows: Graphite's words, in a tone, with an icon and, on hover, why. */
export type StackRowPill = {
  label: string;
  tone: 'success' | 'danger' | 'attention' | 'neutral' | 'done';
  icon?: IconName;
  title?: string;
};

/**
 * The one pill Graphite's stack card shows for a PR in the stack, the first that applies in the order the sidebar's next
 * step goes by: its state, GitHub merging it with the viewed PR as a stack (`stackToMerge`, which `mergingAsStack` says
 * of it: the viewed PR's row reads "Ready to merge as stack", one below it "Ready to merge"), conflicts, open
 * conversations, a failing required check (of `requiredCheckNames`, those its page or its row details name), reviews,
 * running checks, and last what GitHub says of merging it. None while GitHub has not said whether it can merge.
 */
export function stackRowPillFor(entry: PrSummary | StackEntry, requiredCheckNames: readonly string[] = [], mergingAsStack: 'viewed' | 'below' | null = null): StackRowPill | null {
  if (entry.state === 'MERGED') return { label: 'Merged', tone: 'done', icon: 'git-merge' };
  if (entry.state === 'CLOSED') return { label: 'Closed', tone: 'danger', icon: 'git-pull-request-closed' };
  if (entry.isDraft || entry.mergeStatus === 'DRAFT') return { label: 'Draft', tone: 'neutral', icon: 'git-pull-request-draft' };
  if (mergingAsStack) return { label: mergingAsStack === 'viewed' ? 'Ready to merge as stack' : 'Ready to merge', tone: 'success', icon: 'check' };
  if (entry.mergeStatus === 'DIRTY') return { label: 'Merge conflicts', tone: 'danger', icon: 'alert', title: 'Merge conflicts with the base branch' };
  const unresolved = entry.conversations ? entry.conversations.total - entry.conversations.resolved : 0;
  if (unresolved > 0) {
    return {
      label: 'Unresolved comments',
      tone: 'attention',
      icon: 'comment-discussion',
      title: `${unresolved} open comment ${unresolved === 1 ? 'thread needs' : 'threads need'} resolving before this PR can merge`,
    };
  }
  // Only a required check's failure stands in the way, as in the sidebar: GitHub merges over optional ones.
  const failing = entry.ci.checks.filter((check) => check.state === 'FAILURE' && requiredCheckNames.includes(check.name)).map((check) => check.name);
  if (failing.length > 0) return { label: 'Required checks failed', tone: 'danger', icon: 'x-circle-fill', title: `Failing: ${failing.join(', ')}` };
  if (entry.reviewDecision === 'CHANGES_REQUESTED') {
    const requesters = entry.reviewers.filter((reviewer) => reviewer.state === 'CHANGES_REQUESTED').map((reviewer) => reviewer.user.login);
    return { label: 'Changes requested', tone: 'danger', icon: 'x-circle-fill', title: requesters.length > 0 ? `Changes requested by ${requesters.join(', ')}` : undefined };
  }
  if (entry.reviewDecision === 'REVIEW_REQUIRED') {
    const pending = entry.reviewers.filter((reviewer) => reviewer.state === 'PENDING').map((reviewer) => reviewer.user.login);
    return { label: 'Needs reviewers', tone: 'attention', icon: 'person-check', title: pending.length > 0 ? `Waiting for ${pending.join(', ')}` : 'No reviewers requested' };
  }
  if (entry.ci.state === 'PENDING') {
    // Without a check list (GitHub's rollup has only counts), the counts say how many are still running.
    const { success, failure, pending, other } = entry.ci.counts;
    const total = entry.ci.checks.length || success + failure + pending + other;
    const running = entry.ci.checks.length > 0 ? entry.ci.checks.filter((check) => check.state === 'PENDING').length : pending;
    return { label: 'CI running', tone: 'neutral', icon: 'clock', title: `${total - running}/${total} checks finished` };
  }
  switch (entry.mergeStatus) {
    case 'BEHIND':
      return { label: 'Behind base', tone: 'attention', icon: 'arrow-down', title: 'The base branch has commits this branch does not' };
    case 'BLOCKED':
      return { label: 'Blocked', tone: 'neutral', title: 'Blocked by branch protection: required reviews or checks are missing' };
    case 'HAS_HOOKS':
      return { label: 'Waiting on hooks', tone: 'neutral', icon: 'clock', title: 'Mergeable once pre-receive hooks pass' };
    case 'CLEAN':
    case 'UNSTABLE':
      return { label: 'Ready to merge', tone: 'success', icon: 'check' };
    case 'UNKNOWN':
      return null;
  }
}

/**
 * The PRs that merging this one as a stack merges, bottom first and this one last: in a GitHub-native stack, every open
 * PR from the bottom up to this one, when there are open PRs below it and GitHub says each of them, and this one, is
 * ready to merge as a stack. Null otherwise; a stack Graphite's comment lists merges a PR at a time.
 */
export function stackToMerge(stack: Stack): StackEntry[] | null {
  if (stack.source !== 'native') return null;
  const merging = stack.entries.slice(0, stack.currentIndex + 1).filter((entry) => entry.state === 'OPEN');
  return merging.length > 1 && merging.every((entry) => entry.readyToMergeAsStack) ? merging : null;
}

/**
 * The rows the stack card draws, top first: the line from its tip down, each entry's forks right above it, with the
 * entry's index on the line (a fork has none). A merged PR is left out while `show.merged` is off, and a closed one while
 * `show.closed` is (Graphite's ⋯ "Show merged PRs" and "Show closed PRs"), on the line or off it, but never the viewed PR;
 * a fork whose parent is left out stays, right above the next row drawn below it.
 */
export function stackRowsFor(stack: Stack, show: { merged: boolean; closed: boolean }): Array<{ pr: StackEntry; index: number | null }> {
  return stack.entries
    .map((pr, index) => ({ pr, index }))
    .reverse()
    .flatMap(({ pr, index }): Array<{ pr: StackEntry; index: number | null }> => [...forksOff(stack.forks, pr.number).map((fork) => ({ pr: fork, index: null })), { pr, index }])
    .filter(({ pr, index }) => index === stack.currentIndex || ((pr.state !== 'MERGED' || show.merged) && (pr.state !== 'CLOSED' || show.closed)));
}

/**
 * The forks that branch off the entry numbered `number`, in the order Graphite draws them above it: each fork's own forks,
 * its sub-line, right above it.
 */
function forksOff(forks: StackEntry[], number: number): StackEntry[] {
  return forks.filter((fork) => fork.parentNumber === number).flatMap((fork) => [...forksOff(forks, fork.number), fork]);
}
