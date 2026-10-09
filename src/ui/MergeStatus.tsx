// Pill for where a PR stands on merging: Ready to merge, Blocked, Behind base, Conflicts, Checks failing, Draft, Merged, Closed.
// `variant="icon"` is the inbox's Merge column as Graphite draws it: green check when mergeable, red x on conflicts,
// orange alert when blocked, behind or failing checks, grey draft glyph or dash otherwise, purple when merged.
import type { PrSummary } from '../lib/model';
import { Icon, type IconName } from './Icon';
import { StatusPill } from './StatusPill';

export function MergeStatus({ status, state, variant = 'pill' }: { status: PrSummary['mergeStatus']; state: PrSummary['state']; variant?: 'pill' | 'icon' }) {
  if (variant === 'icon') {
    const [icon, tone, label] = state === 'OPEN' ? GRAPHITE_APPEARANCE[status] : GRAPHITE_APPEARANCE[state];
    return (
      <span className={`gg-status-icon gg-status-icon--${tone}`}>
        <Icon name={icon} size={16} title={label} />
      </span>
    );
  }
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

const GRAPHITE_APPEARANCE: Record<PrSummary['mergeStatus'] | 'MERGED' | 'CLOSED', [IconName, 'success' | 'attention' | 'danger' | 'done' | 'subtle', string]> = {
  CLEAN: ['check-circle-fill', 'success', 'Ready to merge'],
  HAS_HOOKS: ['check-circle-fill', 'success', 'Mergeable once pre-receive hooks pass'],
  DIRTY: ['x-circle-fill', 'danger', 'Merge conflicts with the base branch'],
  BLOCKED: ['alert', 'attention', 'Blocked: required reviews or checks are missing'],
  BEHIND: ['alert', 'attention', 'Behind the base branch'],
  UNSTABLE: ['alert', 'attention', 'Mergeable, but some checks are failing'],
  DRAFT: ['git-pull-request-draft', 'subtle', 'Draft'],
  UNKNOWN: ['dash', 'subtle', 'Merge status unknown'],
  MERGED: ['git-merge', 'done', 'Merged'],
  CLOSED: ['git-pull-request-closed', 'danger', 'Closed without merging'],
};
