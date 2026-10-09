// Pill for where a PR stands on merging: Ready to merge, Blocked, Behind base, Conflicts, Checks failing, Draft, Merged, Closed.
import type { PrSummary } from '../lib/model';
import { StatusPill } from './StatusPill';

export function MergeStatus({ status, state }: { status: PrSummary['mergeStatus']; state: PrSummary['state'] }) {
  if (state === 'MERGED') return <StatusPill tone="done" icon="git-merge">Merged</StatusPill>;
  if (state === 'CLOSED') return <StatusPill tone="danger" icon="git-pull-request-closed">Closed</StatusPill>;
  switch (status) {
    case 'CLEAN':
      return <StatusPill tone="success" icon="check">Ready to merge</StatusPill>;
    case 'BLOCKED':
      return (
        <StatusPill tone="neutral" title="Blocked by branch protection: required reviews or checks are missing">
          Blocked
        </StatusPill>
      );
    case 'BEHIND':
      return (
        <StatusPill tone="attention" icon="arrow-down" title="The base branch has commits this branch does not">
          Behind base
        </StatusPill>
      );
    case 'DIRTY':
      return (
        <StatusPill tone="danger" icon="alert" title="Merge conflicts with the base branch">
          Conflicts
        </StatusPill>
      );
    case 'UNSTABLE':
      return (
        <StatusPill tone="attention" icon="x" title="Mergeable, but some checks are failing">
          Checks failing
        </StatusPill>
      );
    case 'HAS_HOOKS':
      return (
        <StatusPill tone="neutral" icon="clock" title="Mergeable once pre-receive hooks pass">
          Waiting on hooks
        </StatusPill>
      );
    case 'DRAFT':
      return <StatusPill tone="neutral" icon="git-pull-request-draft">Draft</StatusPill>;
    case 'UNKNOWN':
      return null;
  }
}
