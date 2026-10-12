// Icon for a PR's review decision or one reviewer's state: approved green, changes requested red, awaiting review yellow
// clock, none grey. The inbox's Review column is reviewStatusIcon (status-icons.ts).
import type { ReviewDecision, ReviewerSummary } from '../lib/model';
import { Icon, type IconName } from './Icon';
import './ui.css';

export function ReviewStatus({ state, size = 16 }: { state: ReviewDecision | ReviewerSummary['state']; size?: number }) {
  const [icon, tone, label] = APPEARANCE[state];
  return (
    <span className={`gg-review gg-review--${tone}`}>
      <Icon name={icon} size={size} title={label} />
    </span>
  );
}

const APPEARANCE: Record<ReviewDecision | ReviewerSummary['state'], [IconName, 'success' | 'danger' | 'attention' | 'muted' | 'subtle', string]> = {
  APPROVED: ['check', 'success', 'Approved'],
  CHANGES_REQUESTED: ['file-diff', 'danger', 'Changes requested'],
  REVIEW_REQUIRED: ['clock', 'attention', 'Review required'],
  PENDING: ['clock', 'attention', 'Awaiting review'],
  COMMENTED: ['comment', 'muted', 'Commented'],
  DISMISSED: ['x', 'muted', 'Review dismissed'],
  NONE: ['circle', 'subtle', 'No review required'],
};
