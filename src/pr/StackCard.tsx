// The stack card: every PR in the stack on a vertical rail, tip at the top and trunk at the bottom; and the card as it
// looks while the stack loads.
import type { Stack, StackEntry } from '../lib/model';
import { Avatar } from '../ui/Avatar';
import { Card } from '../ui/Card';
import { CiStatus } from '../ui/CiStatus';
import { Icon } from '../ui/Icon';
import { MergeStatus } from '../ui/MergeStatus';
import { RelativeTime } from '../ui/RelativeTime';
import { ReviewStatus } from '../ui/ReviewStatus';
import { Skeleton } from '../ui/Skeleton';
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

/** The stack card before its entries arrive: its header, and a row each for a few of them. */
export function StackSkeleton() {
  return (
    <Card className="stack-card">
      <div className="stack-header is-loading" aria-busy="true" aria-label="Loading the stack">
        <Icon name="stack" size={14} className="pr-fg-muted" />
        <span>Stack</span>
      </div>
      <ol className="stack-rail">
        {['55%', '45%', '50%'].map((width, index) => (
          <li key={index} className="stack-row">
            <span className="stack-dot" />
            <span className="stack-author">
              <Skeleton width={16} height={16} />
            </span>
            <Skeleton width={28} height={10} />
            <Skeleton width={width} height={10} />
          </li>
        ))}
      </ol>
    </Card>
  );
}

function StackRow({ pr, current }: { pr: StackEntry; current: boolean }) {
  return (
    <li className={`stack-row ${current ? 'is-current' : ''} ${pr.state === 'MERGED' ? 'is-merged' : ''}`}>
      <span className="stack-dot" />
      {/* Who opened it; an entry whose page header GitHub did not answer keeps the space empty. */}
      <span className="stack-author">{pr.author && <Avatar user={pr.author} size={16} />}</span>
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
        {/* Graphite's conversation counter, resolved of all; an entry with none, or whose threads GitHub did not send, shows nothing. */}
        {pr.conversations && pr.conversations.total > 0 && (
          <span
            className="stack-conversations pr-muted"
            title={`${pr.conversations.resolved} of ${pr.conversations.total} ${pr.conversations.total === 1 ? 'conversation' : 'conversations'} resolved`}
          >
            <Icon name="comment-discussion" size={12} />
            {pr.conversations.resolved}/{pr.conversations.total}
          </span>
        )}
        {/* An entry known only from the stack's own listing has no review decision; leave it out rather than say "none". */}
        {pr.reviewDecision !== 'NONE' && <ReviewStatus state={pr.reviewDecision} size={14} />}
        <CiStatus ci={pr.ci} variant="compact" />
        <MergeStatus status={pr.mergeStatus} state={pr.state} />
        <RelativeTime date={pr.updatedAt} />
      </span>
    </li>
  );
}
