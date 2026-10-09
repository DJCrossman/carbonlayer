// Icon for a PR's review decision or one reviewer's state: approved green, changes requested red, awaiting review yellow
// clock, none grey. `variant="icon"` is the inbox's Review column as Graphite draws it: approved a green person-check,
// changes requested an orange pencil, a draft the draft glyph, anything else a grey dash.
import type { ReviewDecision, ReviewerSummary } from '../lib/model';
import { Icon, type IconName } from './Icon';
import './ui.css';

export function ReviewStatus({
  state,
  size = 16,
  isDraft = false,
  variant = 'verdict',
}: {
  state: ReviewDecision | ReviewerSummary['state'];
  size?: number;
  /** A draft is not up for review, whatever its reviews say (`variant="icon"` only). */
  isDraft?: boolean;
  variant?: 'verdict' | 'icon';
}) {
  if (variant === 'icon') {
    const [icon, tone, label] = isDraft ? (['git-pull-request-draft', 'subtle', 'Draft'] as const) : GRAPHITE_APPEARANCE[state];
    return (
      <span className={`gg-status-icon gg-status-icon--${tone}`}>
        <Icon name={icon} size={size} title={label} />
      </span>
    );
  }
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

const GRAPHITE_APPEARANCE: Record<ReviewDecision | ReviewerSummary['state'], [IconName, 'success' | 'attention' | 'subtle', string]> = {
  APPROVED: ['person-check', 'success', 'Approved'],
  CHANGES_REQUESTED: ['pencil', 'attention', 'Changes requested'],
  REVIEW_REQUIRED: ['dash', 'subtle', 'Review required'],
  PENDING: ['dash', 'subtle', 'Awaiting review'],
  COMMENTED: ['dash', 'subtle', 'Commented'],
  DISMISSED: ['dash', 'subtle', 'Review dismissed'],
  NONE: ['dash', 'subtle', 'No review required'],
};
