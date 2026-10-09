// The stack card: every PR in the stack on a vertical rail, tip at the top and trunk at the bottom.
import type { PrSummary, Stack } from '../lib/model';
import { goToPr } from './navigation';
import { CheckIcon, Icon, RelativeTime, ReviewStateIcon, StatePill } from './primitives';
import './stack.css';

export function StackCard({ stack, collapsed, onToggle }: { stack: Stack; collapsed: boolean; onToggle: () => void }) {
  const tipFirst = stack.entries.map((pr, index) => ({ pr, index })).reverse();
  return (
    <section className="gg-card stack-card" aria-label="Stack">
      <button className="stack-header" onClick={onToggle} aria-expanded={!collapsed} title="Toggle stack (s)">
        <Icon name="stack" size={14} className="gg-fg-muted" />
        <span>
          Stack <span className="gg-muted">· {stack.currentIndex + 1} of {stack.entries.length}</span>
        </span>
        <span className="files-toolbar-spacer" />
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} className="gg-fg-muted" />
      </button>
      {!collapsed && (
        <ol className="stack-rail">
          {tipFirst.map(({ pr, index }) => (
            <StackRow key={pr.id} pr={pr} current={index === stack.currentIndex} />
          ))}
          <li className="stack-row is-trunk">
            <span className="stack-dot" />
            <span className="gg-mono">{stack.trunk}</span>
            <span className="gg-muted">trunk</span>
          </li>
        </ol>
      )}
    </section>
  );
}

function StackRow({ pr, current }: { pr: PrSummary; current: boolean }) {
  return (
    <li className={`stack-row ${current ? 'is-current' : ''} ${pr.state === 'MERGED' ? 'is-merged' : ''}`}>
      <span className="stack-dot" />
      <span className="stack-number gg-muted">#{pr.number}</span>
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
          <span className="stack-comments gg-muted" title={`${pr.commentCount} comments`}>
            <Icon name="comment" size={12} />
            {pr.commentCount}
          </span>
        )}
        {pr.reviewDecision !== 'NONE' && (
          <span title={`Review: ${pr.reviewDecision.toLowerCase().replace('_', ' ')}`}>
            <ReviewStateIcon state={pr.reviewDecision === 'REVIEW_REQUIRED' ? 'PENDING' : pr.reviewDecision} size={14} />
          </span>
        )}
        <span title={`Checks: ${pr.ci.state.toLowerCase()}`}>
          <CheckIcon state={pr.ci.state} size={14} />
        </span>
        <StatePill pr={pr} compact />
        <RelativeTime iso={pr.updatedAt} />
      </span>
    </li>
  );
}
