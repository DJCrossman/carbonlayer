// The single next step a pull request is waiting on, as shown in the sidebar's action card.

import type { PrDetail, PrStage, Stack, StackEntry } from '../lib/model';

/**
 * What stands between this PR and being merged, most fundamental first: its state, then conflicts, what GitHub says of
 * its native stack's branches, the stack below it, open conversations, required checks, reviews, and finally branch
 * protection. When nothing does, it is ready to merge, and in a GitHub-native stack that GitHub can merge from the
 * bottom up to it, ready to merge as a stack: GitHub's verdict then stands for the open PRs below it. While a stage that
 * a step depends on has not arrived (`unknown`), the answer stops at that step: "Checking mergeability…".
 */
export function nextActionFor(pr: PrDetail, unknown: readonly PrStage[] = []): NextAction {
  if (pr.state === 'MERGED') return { kind: 'merged', tone: 'done', title: 'Merged', detail: null };
  if (pr.state === 'CLOSED') return { kind: 'closed', tone: 'neutral', title: 'Closed', detail: 'Closed without merging.' };
  if (pr.isDraft || pr.mergeStatus === 'DRAFT') {
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
  // The PR closest to trunk that is still open has to merge first, unless GitHub can merge it and this one as a stack.
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
  // Only a required check's failure stands in the way: GitHub merges over optional ones, and so does Graphite.
  const failing = pr.ci.checks.filter((check) => check.state === 'FAILURE');
  const required = pr.ci.checks.filter((check) => pr.requiredCheckNames.includes(check.name));
  const requiredFailing = required.filter((check) => check.state === 'FAILURE').length;
  if (requiredFailing > 0) {
    return {
      kind: 'checks-failed',
      tone: 'danger',
      title: 'Required checks failed',
      detail: `${requiredFailing} of ${required.length} required ${required.length === 1 ? 'check' : 'checks'} failed`,
    };
  }
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
