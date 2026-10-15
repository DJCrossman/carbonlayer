// What the inbox's Review, CI and Merge columns show for a pull request, the way Graphite draws them: one icon each, in
// a tone, with a tooltip that says why. One function per column, so the PR page can show the same verdicts.
import type { CiSummary, PrSummary, ReviewDecision, ReviewerSummary } from '../lib/model';
import type { IconName } from './Icon';

/**
 * Where the reviews stand, from the viewer's side: changes requested by anyone first, then the viewer's own approval,
 * then others' reviews (approvals and comments), then requests nobody has answered, then none at all. `reviewers` is
 * null while GitHub has not said who reviews (the row is not enriched yet, or GitHub named nobody); the dashboard's
 * review decision speaks until then. `viewerLogin` keeps the viewer out of "Reviewed by".
 */
export function reviewStatusIcon(
  pr: { isDraft: boolean; reviewDecision: ReviewDecision; reviewers: ReviewerSummary[] | null; viewerReview?: ReviewerSummary['state'] | null },
  viewerLogin: string | null,
): StatusIcon {
  if (pr.isDraft) return { icon: 'pencil', tone: 'subtle', tooltip: 'Draft' };
  if (pr.reviewers === null) {
    switch (pr.reviewDecision) {
      case 'APPROVED':
        return { icon: 'person-check', tone: 'success', tooltip: 'Approved' };
      case 'CHANGES_REQUESTED':
        return { icon: 'pencil', tone: 'severe', tooltip: 'Changes requested' };
      case 'REVIEW_REQUIRED':
        return { icon: 'clock', tone: 'severe', tooltip: 'Waiting for review' };
      case 'NONE':
        return { icon: 'dash', tone: 'subtle', tooltip: 'No review required' };
    }
  }
  const { reviewers } = pr;
  const isViewer = (reviewer: ReviewerSummary) => viewerLogin !== null && reviewer.user.login.toLowerCase() === viewerLogin.toLowerCase();
  // The viewer is "you".
  const changesRequestedBy = reviewers
    .filter((reviewer) => reviewer.state === 'CHANGES_REQUESTED')
    .map((reviewer) => (isViewer(reviewer) ? 'you' : reviewer.user.login))
    .join(', ');
  // As in Graphite, a review is an approval or a request for changes; a comment-only review (Copilot's, a drive-by)
  // leaves the column empty and is only named on hover.
  const reviewedBy = reviewers
    .filter((reviewer) => reviewer.state === 'APPROVED' && !isViewer(reviewer))
    .map((reviewer) => reviewer.user.login)
    .join(', ');
  const commentedBy = reviewers
    .filter((reviewer) => reviewer.state === 'COMMENTED')
    .map((reviewer) => (isViewer(reviewer) ? 'you' : reviewer.user.login))
    .join(', ');
  const waitingFor = reviewers
    .filter((reviewer) => reviewer.state === 'PENDING')
    .map((reviewer) => (isViewer(reviewer) ? 'you' : reviewer.user.login))
    .join(', ');
  const viewerReview = pr.viewerReview ?? reviewers.find(isViewer)?.state ?? null;

  if (changesRequestedBy) return { icon: 'pencil', tone: 'severe', tooltip: `Changes requested by ${changesRequestedBy}` };
  if (viewerReview === 'APPROVED') return { icon: 'check-circle-fill', tone: 'success', tooltip: 'Approved by you' };
  if (reviewedBy) return { icon: 'person-check', tone: 'success', tooltip: `Reviewed by ${reviewedBy}${waitingFor ? `; waiting for ${waitingFor}` : ''}` };
  if (waitingFor) return { icon: 'clock', tone: 'severe', tooltip: `Waiting for ${waitingFor}` };
  if (reviewers.length === 0) return { icon: 'dash', tone: 'subtle', tooltip: 'No reviewers requested' };
  return { icon: 'dash', tone: 'subtle', tooltip: commentedBy ? `No reviews yet (${commentedBy} commented)` : 'No reviews yet' };
}

/**
 * Where the checks stand. A failure blocks merging only when a required check fails: failing checks that are all
 * optional are a yellow pass. `requiredCheckNames` is null until GitHub has said which checks are required (the
 * dashboard's rollup does not), and a failure is red until then.
 */
export function ciStatusIcon(ci: CiSummary, requiredCheckNames: string[] | null): StatusIcon {
  const { success, failure, pending, other } = ci.counts;
  const total = ci.checks.length || success + failure + pending + other;
  if (total === 0) return { icon: 'dash', tone: 'subtle', tooltip: 'No checks' };
  switch (ci.state) {
    case 'SUCCESS':
      return { icon: 'check-circle-fill', tone: 'success', tooltip: 'All checks passed' };
    case 'PENDING': {
      const running = ci.checks.length > 0 ? ci.checks.filter((check) => check.state === 'PENDING').length : pending;
      const failing = ci.checks.filter((check) => check.state === 'FAILURE').map((check) => check.name);
      return { icon: 'clock', tone: 'severe', tooltip: `Checks running (${total - running}/${total})${failing.length > 0 ? `; failing so far: ${failing.join(', ')}` : ''}` };
    }
    case 'FAILURE':
    case 'CANCELLED': {
      const failing = ci.checks.filter((check) => check.state === 'FAILURE' || check.state === 'CANCELLED').map((check) => check.name);
      if (failing.length === 0 || requiredCheckNames === null) {
        return { icon: 'x-circle-fill', tone: 'danger', tooltip: `Checks failing (${failing.length || failure} of ${total})${failing.length > 0 ? `: ${failing.join(', ')}` : ''}` };
      }
      const required = failing.filter((name) => requiredCheckNames.includes(name));
      return required.length > 0
        ? { icon: 'x-circle-fill', tone: 'danger', tooltip: `Required checks failing: ${required.join(', ')}` }
        : { icon: 'check-circle-fill', tone: 'attention', tooltip: `Non-required checks failing: ${failing.join(', ')}` };
    }
    default:
      return { icon: 'dash', tone: 'subtle', tooltip: 'No verdict from the checks' };
  }
}

/**
 * Where merging stands: merged, closed, queued or set to auto-merge, mergeable, conflicting, or blocked, with the
 * merge box's reason when GitHub gave one. Unknown until GitHub has said (the dashboard does not).
 */
export function mergeStatusIcon(
  pr: Pick<PrSummary, 'state' | 'isDraft' | 'mergeStatus' | 'isInMergeQueue' | 'autoMerge'>,
  blockedReason: string | null = null,
): StatusIcon {
  if (pr.state === 'MERGED') return { icon: 'git-merge', tone: 'done', tooltip: 'Merged' };
  if (pr.state === 'CLOSED') return { icon: 'git-pull-request-closed', tone: 'danger', tooltip: 'Closed' };
  if (pr.isInMergeQueue) return { icon: 'git-merge', tone: 'accent', tooltip: 'Queued in the merge queue' };
  if (pr.autoMerge) return { icon: 'git-merge', tone: 'accent', tooltip: `Auto-merge (${pr.autoMerge.method.toLowerCase()}) once requirements are met` };
  switch (pr.mergeStatus) {
    case 'CLEAN':
    case 'HAS_HOOKS':
      return { icon: 'check-circle-fill', tone: 'success', tooltip: 'Mergeable' };
    case 'DIRTY':
      return { icon: 'x-circle-fill', tone: 'danger', tooltip: 'Merge conflict' };
    // As in Graphite, the column is about conflicts: a PR GitHub still holds back (reviews, checks, a stale base) is
    // mergeable here, and the hover says what GitHub still blocks on; the review and CI columns carry the rest.
    case 'BLOCKED':
      return { icon: 'check-circle-fill', tone: 'success', tooltip: `No merge conflicts; blocked on GitHub: ${blockedReason ?? 'required reviews or checks are missing'}` };
    case 'BEHIND':
      return { icon: 'check-circle-fill', tone: 'success', tooltip: `No merge conflicts; blocked on GitHub: ${blockedReason ?? 'the branch is behind its base'}` };
    case 'UNSTABLE':
      return { icon: 'check-circle-fill', tone: 'success', tooltip: `No merge conflicts; blocked on GitHub: ${blockedReason ?? 'some checks are failing'}` };
    case 'DRAFT':
    case 'UNKNOWN':
      return { icon: 'dash', tone: 'subtle', tooltip: 'Unknown' };
  }
}

/** What a status column shows: an icon, in a tone, and why on hover. */
export interface StatusIcon {
  icon: IconName;
  /** green, yellow, orange, red, purple, blue, grey */
  tone: 'success' | 'attention' | 'severe' | 'danger' | 'done' | 'accent' | 'subtle';
  tooltip: string;
}
