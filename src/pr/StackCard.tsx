// The stack card: every PR in the stack on a vertical rail, tip at the top and trunk at the bottom.
import type { PrSummary, Stack } from '../lib/model';
import { Card } from '../ui/Card';
import { CiStatus } from '../ui/CiStatus';
import { Icon } from '../ui/Icon';
import { MergeStatus } from '../ui/MergeStatus';
import { RelativeTime } from '../ui/RelativeTime';
import { ReviewStatus } from '../ui/ReviewStatus';
import { goToPr } from './navigation';
import './stack.css';

export function StackCard({ stack, collapsed, onToggle }: { stack: Stack; collapsed: boolean; onToggle: () => void }) {
  const tipFirst = stack.entries.map((pr, index) => ({ pr, index })).reverse();
  return (
    <Card className="stack-card">
      <button className="stack-header" onClick={onToggle} aria-expanded={!collapsed} title="Toggle stack (s)">
        <Icon name="stack" size={14} className="pr-fg-muted" />
        <span>
          Stack <span className="pr-muted">· {stack.currentIndex + 1} of {stack.entries.length}</span>
        </span>
        <span className="files-toolbar-spacer" />
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} className="pr-fg-muted" />
      </button>
      {!collapsed && (
        <ol className="stack-rail">
          {tipFirst.map(({ pr, index }) => (
            <StackRow key={pr.id} pr={pr} current={index === stack.currentIndex} />
          ))}
          <li className="stack-row is-trunk">
            <span className="stack-dot" />
            <span className="pr-mono">{stack.trunk}</span>
            <span className="pr-muted">trunk</span>
          </li>
        </ol>
      )}
    </Card>
  );
}

function StackRow({ pr, current }: { pr: PrSummary; current: boolean }) {
  return (
    <li className={`stack-row ${current ? 'is-current' : ''} ${pr.state === 'MERGED' ? 'is-merged' : ''}`}>
      <span className="stack-dot" />
      <span className="stack-number pr-muted">#{pr.number}</span>
      {current ? (
        <span className="stack-title">{pr.title}</span>
      ) : (
        <a
          className="stack-title"
          href={pr.url}
          onClick={(event) => {
            event.preventDefault();
            goToPr(pr);
          }}
        >
          {pr.title}
        </a>
      )}
      <span className="stack-status">
        {pr.commentCount > 0 && (
          <span className="stack-comments pr-muted" title={`${pr.commentCount} comments`}>
            <Icon name="comment" size={12} />
            {pr.commentCount}
          </span>
        )}
        <ReviewStatus state={pr.reviewDecision} size={14} />
        <CiStatus ci={pr.ci} variant="compact" />
        <MergeStatus status={pr.mergeStatus} state={pr.state} />
        <RelativeTime date={pr.updatedAt} />
      </span>
    </li>
  );
}
