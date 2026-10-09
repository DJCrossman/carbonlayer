// CI at a glance from a CiSummary: a segmented bar (one segment per check) or a compact icon with passed/total; hover lists failing checks first.
import type { CheckState, CiSummary } from '../lib/model';
import { Icon } from './Icon';
import './ui.css';

export function CiStatus({ ci, variant = 'bar' }: { ci: CiSummary; variant?: 'bar' | 'compact' }) {
  if (ci.checks.length === 0) return null;
  const failing = ci.checks.filter((check) => check.state === 'FAILURE' || check.state === 'CANCELLED');
  const pending = ci.checks.filter((check) => check.state === 'PENDING');
  const title = [
    failing.length > 0 && `Failing: ${failing.map((check) => check.name).join(', ')}`,
    pending.length > 0 && `Pending: ${pending.map((check) => check.name).join(', ')}`,
    `${ci.counts.success} of ${ci.checks.length} checks passed`,
  ]
    .filter(Boolean)
    .join('\n');

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
        {ci.counts.success}/{ci.checks.length}
      </span>
    );
  }

  // Read like a progress bar: passed checks fill from the left, then failures, then whatever is still running.
  const order: Record<CheckState, number> = { SUCCESS: 0, FAILURE: 1, CANCELLED: 1, PENDING: 2, NEUTRAL: 3, SKIPPED: 3, NONE: 3 };
  const segments = [...ci.checks].sort((a, b) => order[a.state] - order[b.state]);
  return (
    <span className={`gg-ci-bar${segments.length > 16 ? ' gg-ci-bar--dense' : ''}`} title={title} role="img" aria-label={title}>
      {segments.map((check, index) => (
        <span
          key={index}
          className={`gg-ci-bar__seg gg-ci-bar__seg--${
            check.state === 'SUCCESS' ? 'success' : order[check.state] === 1 ? 'danger' : check.state === 'PENDING' ? 'attention' : 'neutral'
          }`}
        />
      ))}
    </span>
  );
}
