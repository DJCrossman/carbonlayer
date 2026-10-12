// CI at a glance from a CiSummary: a segmented bar (one segment per check) or a compact icon with passed/total; hover
// lists failing checks first. Without a check list (GitHub's rollup has only counts) segments come from the counts. The
// inbox's CI column is ciStatusIcon (status-icons.ts).
import type { CiSummary } from '../lib/model';
import { Icon } from './Icon';
import './ui.css';

export function CiStatus({ ci, variant = 'bar' }: { ci: CiSummary; variant?: 'bar' | 'compact' }) {
  const { success, failure, pending, other } = ci.counts;
  const total = ci.checks.length || success + failure + pending + other;
  if (total === 0) return null;
  const failing = ci.checks.filter((check) => check.state === 'FAILURE' || check.state === 'CANCELLED');
  const running = ci.checks.filter((check) => check.state === 'PENDING');
  const title = [
    failing.length > 0 && `Failing: ${failing.map((check) => check.name).join(', ')}`,
    running.length > 0 && `Pending: ${running.map((check) => check.name).join(', ')}`,
    `${success} of ${total} checks passed`,
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
