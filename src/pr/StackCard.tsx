// The stack card: every PR in the stack on a vertical rail, tip at the top and trunk at the bottom, each with its review,
// checks and merge status; and the card as it looks while the stack loads.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import type { DataSource } from '../app/data-source';
import { inboxRowFor, useRowEnrichment } from '../inbox/row-details';
import type { Stack, StackEntry } from '../lib/model';
import type { MergeMethod } from '../lib/rpc';
import { Avatar } from '../ui/Avatar';
import { Card } from '../ui/Card';
import { CiStatus } from '../ui/CiStatus';
import { Icon } from '../ui/Icon';
import { MergeStatus } from '../ui/MergeStatus';
import { RelativeTime } from '../ui/RelativeTime';
import { ReviewStatus } from '../ui/ReviewStatus';
import { Skeleton } from '../ui/Skeleton';
import { StatusPill } from '../ui/StatusPill';
import { goToPr } from './navigation';
import { stackToMerge } from './next-action';
import { useLoadAhead } from './page-data';
import './stack.css';

/**
 * The stack's entries. The viewed PR's statuses come with its page; every other entry's with the same row details the
 * inbox shows for a PR (src/inbox/row-details.ts), asked for while the card is open and kept under the inbox's own key
 * for a PR the inbox showed, so either page finds what the other asked for. An entry the pointer rests on loads its page
 * ahead, as an inbox row does.
 */
export function StackCard({
  stack,
  collapsed,
  onToggle,
  source,
  mergeMethod,
}: {
  stack: Stack;
  collapsed: boolean;
  onToggle: () => void;
  source: DataSource;
  /** The merge method in the settings, which the row details go by. */
  mergeMethod: MergeMethod;
}) {
  const queryClient = useQueryClient();
  // Each other entry as the inbox last showed it, when it did, else as the stack names it.
  const rows = useMemo(
    () => new Map(stack.entries.flatMap((entry, index) => (index === stack.currentIndex ? [] : [[entry.id, inboxRowFor(queryClient, entry.repo, entry.number) ?? entry] as const]))),
    [queryClient, stack],
  );
  const details = useRowEnrichment(source, [...rows.values()], mergeMethod);
  const loadAhead = useLoadAhead(source);
  useEffect(() => {
    if (!collapsed) for (const row of rows.values()) details.want(row);
  }, [rows, collapsed]);
  const tipFirst = stack.entries.map((pr, index) => ({ pr, index })).reverse();
  // The PRs GitHub can merge with the viewed one as a stack, whose rows say so as Graphite's do.
  const mergingAsStack = stackToMerge(stack);
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
          {tipFirst.map(({ pr, index }) => {
            const row = rows.get(pr.id);
            const found = row && details.found.get(row.id)?.enrichment;
            // What the inbox would show for it: its row's verdict and checks, what its details found over them.
            const shown = row && found ? { ...pr, reviewDecision: row.reviewDecision, ci: row.ci, ...found } : pr;
            return (
              <StackRow
                key={pr.id}
                pr={shown}
                current={index === stack.currentIndex}
                waiting={row !== undefined && found === undefined}
                readyToMerge={mergingAsStack?.includes(pr) ?? false}
                onIntent={() => loadAhead(pr)}
              />
            );
          })}
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

function StackRow({
  pr,
  current,
  waiting,
  readyToMerge,
  onIntent,
}: {
  pr: StackEntry;
  current: boolean;
  /** Its row details have not arrived and the cache had none: its statuses show small skeletons. */
  waiting: boolean;
  /** GitHub can merge it in merging the viewed PR as a stack: the viewed PR's row reads "Ready to merge as stack", one below it "Ready to merge". */
  readyToMerge: boolean;
  /** The pointer rested on another entry: the viewer may open it next. */
  onIntent: () => void;
}) {
  // The pointer resting 150 ms on the entry, not passing over it.
  const resting = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(resting.current), []);
  return (
    <li
      className={`stack-row ${current ? 'is-current' : ''} ${pr.state === 'MERGED' ? 'is-merged' : ''}`}
      onMouseEnter={() => !current && (resting.current = setTimeout(onIntent, 150))}
      onMouseLeave={() => clearTimeout(resting.current)}
    >
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
            // A click with ⌘, Ctrl, Shift or Alt, or another button, is the browser's: a new tab or window, or a download.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
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
        {/* As the inbox's row: the verdict waits for the row's details, an open PR's checks and mergeability too, while a
            merged or closed one says so at once. No review needed, no checks or no mergeability known shows nothing. */}
        {waiting ? <Skeleton width={14} height={14} /> : pr.reviewDecision !== 'NONE' && <ReviewStatus state={pr.reviewDecision} size={14} />}
        {waiting && pr.state === 'OPEN' ? <Skeleton width={28} height={10} /> : <CiStatus ci={pr.ci} variant="compact" />}
        {readyToMerge ? (
          <StatusPill tone="success" icon="check">
            {current ? 'Ready to merge as stack' : 'Ready to merge'}
          </StatusPill>
        ) : waiting && pr.state === 'OPEN' ? (
          <Skeleton width={48} height={10} />
        ) : (
          <MergeStatus status={pr.mergeStatus} state={pr.state} />
        )}
        <RelativeTime date={pr.updatedAt} />
        {/* Graphite's, after the age: GitHub merges it once every PR auto-merge covers meets the merge requirements. */}
        {pr.willMergeWhenReady && <span className="stack-merge-when-ready">will merge when ready</span>}
      </span>
    </li>
  );
}
