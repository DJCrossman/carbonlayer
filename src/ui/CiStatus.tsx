// CI at a glance from a CiSummary: a segmented bar (one segment per check), a compact icon with passed/total, or (`icon`)
// the inbox's CI column as Graphite draws it, one icon: green check, red x, orange clock, grey dash for none; hover lists
// failing checks first. The inbox only has GitHub's rollup (counts, no per-check detail), so segments come from the
// counts when there is no check list.
import type { CiSummary } from '../lib/model';
import { Icon } from './Icon';
import './ui.css';

export function CiStatus({ ci, variant = 'bar' }: { ci: CiSummary; variant?: 'bar' | 'compact' | 'icon' }) {
  const { success, failure, pending, other } = ci.counts;
  const total = ci.checks.length || success + failure + pending + other;
  if (total === 0 && variant !== 'icon') return null;
  const failing = ci.checks.filter((check) => check.state === 'FAILURE' || check.state === 'CANCELLED');
  const running = ci.checks.filter((check) => check.state === 'PENDING');
  const title = [
    failing.length > 0 && `Failing: ${failing.map((check) => check.name).join(', ')}`,
    running.length > 0 && `Pending: ${running.map((check) => check.name).join(', ')}`,
    `${success} of ${total} checks passed`,
  ]
    .filter(Boolean)
    .join('\n');

  if (variant === 'icon') {
    const [icon, tone, label] =
      total === 0
        ? (['dash', 'subtle', 'No CI checks'] as const)
        : ci.state === 'SUCCESS'
          ? (['check-circle-fill', 'success', 'CI passed'] as const)
          : ci.state === 'FAILURE' || ci.state === 'CANCELLED'
            ? (['x-circle-fill', 'danger', 'CI failed'] as const)
            : ci.state === 'PENDING'
              ? (['clock', 'attention', 'CI running'] as const)
              : (['dash', 'subtle', 'No CI verdict'] as const);
    return (
      <span className={`gg-status-icon gg-status-icon--${tone}`}>
        <Icon name={icon} size={16} title={total === 0 ? label : `${label}\n${title}`} />
      </span>
    );
  }

  if (variant === 'compact') {
    const [icon, tone] =
      ci.state === 'SUCCESS'
        ? (['check', 'success'] as const)
        : ci.state === 'FAILURE' || ci.state === 'CANCELLED'
          ? (['x', 'danger'] as const)
          : ci.state === 'PENDING'
            ? (['dot-fill', 'attention'] as const)
            : (['skip', 'neutral'] as const);
    return (
      <span className={`gg-ci-compact gg-ci-compact--${tone}`} title={title}>
        <Icon name={icon} size={14} />
        {success}/{total}
      </span>
    );
  }

  const segments: Array<'success' | 'danger' | 'attention' | 'neutral'> =
    ci.checks.length > 0
      ? ci.checks.map((check) =>
          check.state === 'SUCCESS' ? 'success' : check.state === 'FAILURE' || check.state === 'CANCELLED' ? 'danger' : check.state === 'PENDING' ? 'attention' : 'neutral',
        )
      : [
          ...Array<'success'>(success).fill('success'),
          ...Array<'danger'>(failure).fill('danger'),
          ...Array<'attention'>(pending).fill('attention'),
          ...Array<'neutral'>(other).fill('neutral'),
        ];
  // Read like a progress bar: passed checks fill from the left, then failures, then whatever is still running.
  const order = ['success', 'danger', 'attention', 'neutral'];
  segments.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return (
    <span className={`gg-ci-bar${segments.length > 16 ? ' gg-ci-bar--dense' : ''}`} title={title} role="img" aria-label={title}>
      {segments.map((tone, index) => (
        <span key={index} className={`gg-ci-bar__seg gg-ci-bar__seg--${tone}`} />
      ))}
    </span>
  );
}
