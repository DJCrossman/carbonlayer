// The single next step a pull request is waiting on, as shown in the sidebar's action card.

import type { PrDetail, PrStage, PrSummary } from '../lib/model';

/**
 * What stands between this PR and being merged, most fundamental first: its state, then conflicts,
 * the stack below it, open conversations, required checks, reviews, and finally branch protection. When nothing
 * does, it is ready to merge. While a stage that a step depends on has not arrived (`unknown`), the
 * answer stops at that step: "Checking mergeability…".
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
    return { kind: 'conflicts', tone: 'danger', title: `Conflicts with ${pr.baseRefName}`, detail: 'Resolve them before this PR can merge.' };
  }
  if (unknown.includes('stack')) return checking;
  // The PR closest to trunk that is still open has to merge first.
  const downstack = pr.stack.entries.slice(0, pr.stack.currentIndex).find((entry) => entry.state === 'OPEN');
  if (downstack) {
    return { kind: 'downstack', tone: 'attention', title: `Waiting on downstack · #${downstack.number}`, detail: downstack.title, pr: downstack };
  }
  if (unknown.includes('threads')) return checking;
  if (pr.unresolvedThreadCount > 0) {
    const count = pr.unresolvedThreadCount;
    return {
      kind: 'unresolved',
      tone: 'attention',
      title: 'Unresolved comments',
      detail: `${count} ${count === 1 ? 'thread needs' : 'threads need'} resolving`,
    };
  }
  if (unknown.includes('checks')) return checking;
  // Only a required check's failure stands in the way: GitHub merges over optional ones, and so does Graphite.
  const failing = pr.ci.checks.filter((check) => check.state === 'FAILURE');
  const requiredFailing = failing.find((check) => pr.requiredCheckNames.includes(check.name));
  if (requiredFailing) return { kind: 'checks-failed', tone: 'danger', title: 'Checks failed', detail: requiredFailing.name };
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
    return { kind: 'review-required', tone: 'attention', title: 'Waiting for review', detail: pending.length > 0 ? pending.join(', ') : null };
  }
  if (pr.ci.state === 'PENDING') {
    const finished = pr.ci.checks.filter((check) => check.state !== 'PENDING').length;
    return { kind: 'checks-running', tone: 'attention', title: `Checks running · ${finished}/${pr.ci.checks.length}`, detail: null };
  }
  if (pr.mergeStatus === 'BEHIND') {
    return { kind: 'behind', tone: 'attention', title: `Behind ${pr.baseRefName}`, detail: 'Update the branch on GitHub.' };
  }
  if (pr.mergeStatus === 'BLOCKED') return { kind: 'blocked', tone: 'danger', title: 'Blocked by branch protection', detail: null };
  return {
    kind: 'ready',
    tone: 'success',
    title: 'Ready to merge',
    detail: failing.length > 0 ? `${failing.length === 1 ? 'An optional check is' : `${failing.length} optional checks are`} failing: ${failing.map((check) => check.name).join(', ')}` : null,
  };
}

type NextAction = {
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
        | 'unresolved'
        | 'checks-failed'
        | 'changes-requested'
        | 'review-required'
        | 'checks-running'
        | 'behind'
        | 'blocked'
        | 'ready';
    }
  | { kind: 'downstack'; pr: PrSummary }
);
