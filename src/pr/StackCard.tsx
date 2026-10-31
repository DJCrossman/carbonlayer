// The stack card: every PR in the stack on a vertical rail, tip at the top and trunk at the bottom, each with its
// conversations and Graphite's one pill for where it stands, a fork off the line indented on a rail of its own; and the
// card as it looks while the stack loads.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import type { DataSource } from '../app/data-source';
import { inboxRowFor, useRowEnrichment } from '../inbox/row-details';
import type { Stack, StackEntry } from '../lib/model';
import type { MergeMethod } from '../lib/rpc';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { RelativeTime } from '../ui/RelativeTime';
import { Skeleton } from '../ui/Skeleton';
import { StatusPill } from '../ui/StatusPill';
import { showToast } from '../ui/Toast';
import { goToPr } from './navigation';
import { stackRowPillFor, stackToMerge } from './next-action';
import { useLoadAhead } from './page-data';
import './stack.css';

/**
 * The stack's entries. The viewed PR's statuses come with its page; every other entry's with the same row details the
 * inbox shows for a PR (src/inbox/row-details.ts), asked for while the card is open and kept under the inbox's own key
 * for a PR the inbox showed, so either page finds what the other asked for. An entry the pointer rests on loads its page
 * ahead, as an inbox row does. A fork off the line is drawn as Graphite draws it: indented, right above the entry it
 * branches from, its dot on a short rail that curves out of the main one, its own forks above it; the header counts the
 * line alone. Its header's Copy stack puts the line on the clipboard as Markdown, as Graphite's comment lists it: the top
 * of the stack first, an item for each PR linked to it, and trunk last. The forks are left out: a list of one line has no
 * place for them that would not read as part of it.
 */
export function StackCard({
  stack,
  requiredCheckNames,
  collapsed,
  onToggle,
  source,
  mergeMethod,
}: {
  stack: Stack;
  /** The viewed PR's required checks, which its page names; each other entry's come with its row details. */
  requiredCheckNames: readonly string[];
  collapsed: boolean;
  onToggle: () => void;
  source: DataSource;
  /** The merge method in the settings, which the row details go by. */
  mergeMethod: MergeMethod;
}) {
  const queryClient = useQueryClient();
  // Each other entry and each fork as the inbox last showed it, when it did, else as the stack names it.
  const rows = useMemo(
    () => new Map([...stack.entries, ...stack.forks].flatMap((entry, index) => (index === stack.currentIndex ? [] : [[entry.id, inboxRowFor(queryClient, entry.repo, entry.number) ?? entry] as const]))),
    [queryClient, stack],
  );
  const details = useRowEnrichment(source, [...rows.values()], mergeMethod);
  const loadAhead = useLoadAhead(source);
  useEffect(() => {
    if (!collapsed) for (const row of rows.values()) details.want(row);
  }, [rows, collapsed]);
  const tipFirst = stack.entries.map((pr, index) => ({ pr, index })).reverse();
  // The rows top first, each entry's forks right above it; a fork has no index on the line.
  const drawn = tipFirst.flatMap(({ pr, index }): Array<{ pr: StackEntry; index: number | null }> => [...forksOff(stack.forks, pr.number).map((fork) => ({ pr: fork, index: null })), { pr, index }]);
  // The PRs GitHub can merge with the viewed one as a stack, whose rows say so as Graphite's do.
  const mergingAsStack = stackToMerge(stack);
  return (
    <Card className="stack-card">
      {/* A click anywhere on the header folds the card, but on Copy stack (stack.css). */}
      <div className="stack-header">
        <button className="stack-toggle" onClick={onToggle} aria-expanded={!collapsed} title="Toggle stack (s)">
          <Icon name="stack" size={14} className="pr-fg-muted" />
          <span>
            Stack <span className="pr-muted">· {stack.currentIndex + 1} of {stack.entries.length}</span>
          </span>
        </button>
        <span className="files-toolbar-spacer" />
        <Button
          variant="ghost"
          size="sm"
          icon="link"
          className="stack-copy"
          onClick={() =>
            navigator.clipboard
              .writeText([...tipFirst.map(({ pr }) => `- [#${pr.number} ${pr.title}](${pr.url})`), `- \`${stack.trunk}\``].join('\n'))
              .then(
                () => showToast('Copied stack'),
                () => showToast('Could not copy the stack', 'danger'),
              )
          }
        >
          Copy stack
        </Button>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} className="pr-fg-muted" />
      </div>
      {!collapsed && (
        <ol className="stack-rail">
          {drawn.map(({ pr, index }) => {
            const row = rows.get(pr.id);
            const found = row && details.found.get(row.id)?.enrichment;
            // What the inbox would show for it: its row's verdict and checks, what its details found over them.
            const shown = row && found ? { ...pr, reviewDecision: row.reviewDecision, ci: row.ci, ...found } : pr;
            return (
              <StackRow
                key={pr.id}
                pr={shown}
                current={index === stack.currentIndex}
                fork={index === null}
                waiting={row !== undefined && found === undefined}
                readyToMerge={mergingAsStack?.includes(pr) ?? false}
                requiredCheckNames={index === stack.currentIndex ? requiredCheckNames : (found?.requiredCheckNames ?? [])}
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
  fork,
  waiting,
  readyToMerge,
  requiredCheckNames,
  onIntent,
}: {
  pr: StackEntry;
  current: boolean;
  /** A PR off the stack's line: its row is indented, its dot on a short rail of its own. */
  fork: boolean;
  /** Its row details have not arrived and the cache had none: its pill shows a small skeleton. */
  waiting: boolean;
  /** GitHub can merge it in merging the viewed PR as a stack: the viewed PR's row reads "Ready to merge as stack", one below it "Ready to merge". */
  readyToMerge: boolean;
  /** The required checks its page or its row details name; none until GitHub has said. */
  requiredCheckNames: readonly string[];
  /** The pointer rested on another entry: the viewer may open it next. */
  onIntent: () => void;
}) {
  // The pointer resting 150 ms on the entry, not passing over it.
  const resting = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(resting.current), []);
  const pill = stackRowPillFor(pr, requiredCheckNames, readyToMerge ? (current ? 'viewed' : 'below') : null);
  return (
    <li
      className={`stack-row ${current ? 'is-current' : ''} ${fork ? 'is-fork' : ''} ${pr.state === 'MERGED' ? 'is-merged' : ''}`}
      onMouseEnter={() => !current && (resting.current = setTimeout(onIntent, 150))}
      onMouseLeave={() => clearTimeout(resting.current)}
    >
      <span className="stack-dot" />
      {/* Who opened it; an entry whose page header GitHub did not answer keeps the space empty. */}
      <span className="stack-author">{pr.author && <Avatar user={pr.author} size={16} />}</span>
      <span className="stack-number pr-muted">#{pr.number}</span>
      {/* The title, and right after it Graphite's "will merge when ready" (GitHub merges it once every PR auto-merge covers
          meets the merge requirements), so the statuses keep their column on every row. */}
      <span className="stack-title-line">
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
        {pr.willMergeWhenReady && <span className="stack-merge-when-ready">will merge when ready</span>}
      </span>
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
        {/* Graphite's one pill, its reason on hover: an open PR's waits for the row's details, unless GitHub merges it with
            the viewed PR as a stack, while a merged or closed one says so at once. No mergeability known shows nothing. */}
        {waiting && pr.state === 'OPEN' && !readyToMerge ? (
          <Skeleton width={72} height={10} />
        ) : (
          pill && (
            <StatusPill tone={pill.tone} icon={pill.icon} title={pill.title}>
              {pill.label}
            </StatusPill>
          )
        )}
        <RelativeTime date={pr.updatedAt} />
      </span>
    </li>
  );
}

/**
 * The forks that branch off the entry numbered `number`, in the order Graphite draws them above it: each fork's own forks,
 * its sub-line, right above it.
 */
function forksOff(forks: StackEntry[], number: number): StackEntry[] {
  return forks.filter((fork) => fork.parentNumber === number).flatMap((fork) => [...forksOff(forks, fork.number), fork]);
}
