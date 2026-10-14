// Graphite's comments drawer: every review conversation and every comment batched for the review, each with the code it
// sits on, filtered by reviewer and status and sorted by file or by age (comments-drawer.ts picks them). It sits to the
// right of the page, which makes room for it. A conversation's header jumps to it in the diff; there, as in the diff,
// it resolves or reopens, takes a reply and reactions.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ReviewThreadDraft } from '../app/data-source';
import { githubUser } from '../lib/github-web/session';
import type { ChangedFile, PrStages, ReviewThread } from '../lib/model';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { Skeleton } from '../ui/Skeleton';
import { Comment } from './Comment';
import { drawerContents, type DrawerEntry, type DrawerFilters } from './comments-drawer';
import type { StageState } from './page-data';
import { CommentInput, Staged } from './primitives';
import { Reactions } from './Reactions';
import type { NoteActions } from './Threads';
import './comments-drawer.css';
// The diff's Outdated and Pending tags, for Stale and Pending here.
import './threads.css';

export function CommentsDrawer({
  threads,
  stage,
  batch,
  files,
  viewerLogin,
  currentThreadId,
  actions,
  onRevealThread,
  onGoToFile,
  onRetry,
  onClose,
}: {
  /** The PR's threads as the page shows them, a resolve already applied. */
  threads: ReviewThread[];
  stage: StageState<PrStages['threads']>;
  batch: ReviewThreadDraft[];
  /** The changed files in the order the diff shows them. */
  files: ChangedFile[];
  viewerLogin: string;
  /** The thread `n` / `p`, or a header here, last moved to. */
  currentThreadId: string | null;
  actions: NoteActions;
  onRevealThread: (threadId: string) => void;
  onGoToFile: (path: string) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [filters, setFilters] = useState<DrawerFilters>({ reviewer: null, status: 'open', order: 'file' });
  const panel = useRef<HTMLElement>(null);
  const { shown, hidden, counts, reviewers } = useMemo(() => drawerContents(threads, batch, files, filters, viewerLogin), [threads, batch, files, filters, viewerLogin]);
  const showAll = () => setFilters((current) => ({ ...current, reviewer: null, status: 'all' }));
  const reviewer = reviewers.find((user) => user.login === filters.reviewer);

  // It takes the focus as it opens, so Esc closes it straight away; the page's shortcuts still work from here.
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);

  const close = () => {
    // Focus inside it goes back to the header's Comments button rather than nowhere.
    if (panel.current?.contains(document.activeElement)) document.querySelector<HTMLElement>('.pr-comments-toggle')?.focus({ preventScroll: true });
    onClose();
  };

  return (
    <aside
      ref={panel}
      className="comments-drawer"
      aria-label="Comments"
      tabIndex={-1}
      onKeyDown={(event) => {
        // Unless something inside took it first: a menu, the reaction picker, a reply box.
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        close();
      }}
    >
      <div className="comments-drawer-header">
        <h2>Comments</h2>
        <Button variant="ghost" size="sm" icon="x" aria-label="Close comments" title="Close (Esc)" onClick={close} />
      </div>
      <div className="comments-drawer-filters">
        <FilterMenu
          name="Reviewer"
          label={
            reviewer ? (
              <>
                <Avatar user={reviewer} size={16} />
                {reviewer.login}
              </>
            ) : (
              'All reviewers'
            )
          }
          items={[
            { key: '', label: 'All reviewers', checked: filters.reviewer === null, onSelect: () => setFilters((current) => ({ ...current, reviewer: null })) },
            ...reviewers.map((user) => ({
              key: user.login,
              label: (
                <>
                  <Avatar user={user} size={16} />
                  {user.login}
                </>
              ),
              checked: filters.reviewer === user.login,
              onSelect: () => setFilters((current) => ({ ...current, reviewer: user.login })),
            })),
          ]}
        />
        <FilterMenu
          name="Status"
          label={STATUS_LABELS[filters.status]}
          items={[
            ...(['open', 'resolved', 'pending'] as const).map((status) => ({
              key: status,
              label: (
                <>
                  {STATUS_LABELS[status]}
                  <span className="comments-filter-count">{counts[status]}</span>
                </>
              ),
              checked: filters.status === status,
              onSelect: () => setFilters((current) => ({ ...current, status })),
            })),
            null,
            { key: 'clear', label: 'Clear all', onSelect: showAll },
          ]}
        />
        <span className="comments-drawer-spacer" />
        <Button
          variant="ghost"
          size="sm"
          icon={filters.order === 'file' ? 'list-ordered' : 'clock'}
          title={filters.order === 'file' ? 'In the order of the diff; click for the newest first' : 'Newest first; click for the order of the diff'}
          onClick={() => setFilters((current) => ({ ...current, order: current.order === 'file' ? 'newest' : 'file' }))}
        >
          {filters.order === 'file' ? 'File order' : 'Newest'}
        </Button>
      </div>
      <div className="comments-drawer-list">
        <Staged
          state={stage}
          what="the review threads"
          onRetry={onRetry}
          skeleton={[0, 1, 2].map((index) => (
            <Skeleton key={index} width="100%" height={96} />
          ))}
        >
          {() =>
            shown.length === 0 ? (
              <div className="comments-drawer-empty">
                <strong>No matching threads</strong>
                {hidden > 0 && (
                  <>
                    <span className="pr-muted">
                      {hidden} {hidden === 1 ? 'thread' : 'threads'} hidden by filters
                    </span>
                    <Button size="sm" onClick={showAll}>
                      Show all
                    </Button>
                  </>
                )}
              </div>
            ) : (
              shown.map((entry) => (
                <Conversation
                  key={entry.kind === 'thread' ? entry.thread.id : `pending:${entry.index}`}
                  entry={entry}
                  current={entry.kind === 'thread' && entry.thread.id === currentThreadId}
                  viewerLogin={viewerLogin}
                  actions={actions}
                  onJump={() => (entry.kind === 'thread' ? onRevealThread(entry.thread.id) : onGoToFile(entry.path))}
                />
              ))
            )
          }
        </Staged>
      </div>
    </aside>
  );
}

/** One conversation: a header that jumps to it in the diff, the code it sits on, its comments and what it can do. */
function Conversation({
  entry,
  current,
  viewerLogin,
  actions,
  onJump,
}: {
  entry: DrawerEntry;
  current: boolean;
  viewerLogin: string;
  actions: NoteActions;
  onJump: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  // The reply being written; null while the reply box is closed.
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { lines } = entry;
  const thread = entry.kind === 'thread' ? entry.thread : null;

  // Moving to a thread in the diff (n / p) brings it into view here too.
  useEffect(() => {
    if (current) card.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const closeReply = () => {
    setReply(null);
    // Back on the Reply button, from where Esc closes the drawer.
    requestAnimationFrame(() => card.current?.querySelector<HTMLElement>('.comments-drawer-reply-toggle')?.focus());
  };
  const sendReply = async () => {
    if (!thread || reply === null) return;
    setBusy(true);
    const ok = await actions.reply(thread.id, reply);
    setBusy(false);
    if (ok) closeReply();
  };
  const toggleResolved = async (resolving: ReviewThread) => {
    setBusy(true);
    await actions.resolve(resolving.id, !resolving.isResolved);
    setBusy(false);
  };

  return (
    <article ref={card} className={`comments-drawer-thread ${thread?.isResolved ? 'is-resolved' : ''} ${current ? 'is-current' : ''}`}>
      <button type="button" className="comments-drawer-thread-header" title={entry.path} onClick={onJump}>
        <Icon
          name={thread?.isResolved ? 'check-circle-fill' : 'comment-discussion'}
          size={14}
          className={thread?.isResolved ? 'pr-fg-success' : thread ? 'pr-fg-muted' : 'pr-fg-attention'}
        />
        <span className="comments-drawer-file">{entry.path.slice(entry.path.lastIndexOf('/') + 1)}</span>
        {lines && (
          <span className="comments-drawer-lines">
            {lines.first.line === lines.last.line && lines.first.side === lines.last.side
              ? `line ${lines.last.side === 'LEFT' ? '−' : '+'}${lines.last.line}`
              : `lines ${lines.first.side === 'LEFT' ? '−' : '+'}${lines.first.line} to ${lines.first.side === lines.last.side ? '' : lines.last.side === 'LEFT' ? '−' : '+'}${lines.last.line}`}
          </span>
        )}
        {thread?.isOutdated && <span className="diff-note-tag">Stale</span>}
        {!thread && <span className="diff-note-tag is-pending">Pending</span>}
      </button>
      {entry.code && (
        <div className="comments-drawer-code">
          {entry.code.map((row, index) => (
            <div key={index} className={`comments-drawer-code-row is-${row.kind}`}>
              <span className="comments-drawer-code-line">{row.line}</span>
              <span className="comments-drawer-code-text">{row.text}</span>
            </div>
          ))}
        </div>
      )}
      <div className="comments-drawer-comments">
        {entry.kind === 'thread' ? (
          entry.thread.comments.map((comment) => (
            <Comment
              key={comment.id}
              author={comment.author}
              createdAt={comment.createdAt}
              bodyHtml={comment.bodyHtml}
              url={comment.url}
              footer={<Reactions subjectId={comment.subjectId} reactions={comment.reactions} />}
              compact
            />
          ))
        ) : (
          <div className="pr-comment is-compact">
            <div className="pr-comment-header">
              <Avatar user={githubUser(viewerLogin)} size={18} />
              <strong>{viewerLogin}</strong>
              <span className="pr-muted">not submitted yet</span>
            </div>
            <p className="comments-drawer-pending-body">{entry.draft.body}</p>
          </div>
        )}
      </div>
      {entry.kind === 'pending' ? (
        <div className="comments-drawer-actions">
          <Button size="sm" icon="x" onClick={() => actions.removePending(entry.index)}>
            Remove
          </Button>
        </div>
      ) : reply === null ? (
        <div className="comments-drawer-actions">
          <Button size="sm" icon="comment" className="comments-drawer-reply-toggle" onClick={() => setReply('')}>
            Reply
          </Button>
          <Button size="sm" icon={entry.thread.isResolved ? 'sync' : 'check'} disabled={busy} onClick={() => void toggleResolved(entry.thread)}>
            {entry.thread.isResolved ? 'Reopen' : 'Resolve'}
          </Button>
        </div>
      ) : (
        <div className="comments-drawer-reply">
          <CommentInput value={reply} onChange={setReply} onSubmit={sendReply} onCancel={closeReply} placeholder="Reply…" autoFocus disabled={busy} />
          <div className="comments-drawer-actions">
            <Button variant="ghost" size="sm" onClick={closeReply}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={busy || reply.trim() === ''} onClick={sendReply}>
              Reply <Kbd>⌘↵</Kbd>
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

/** A filter of the drawer: a button naming what is chosen, opening its choices (`null` draws a divider). */
function FilterMenu({
  name,
  label,
  items,
}: {
  name: string;
  label: ReactNode;
  /** A choice is checked or not; an action (Clear all) has no `checked`. */
  items: Array<{ key: string; label: ReactNode; checked?: boolean; onSelect: () => void } | null>;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !anchor.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div
      className="comments-filter"
      ref={anchor}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        // Only the menu closes, not the drawer.
        event.preventDefault();
        setOpen(false);
        anchor.current?.querySelector<HTMLElement>('.comments-filter-button')?.focus();
      }}
    >
      <Button size="sm" className="comments-filter-button" aria-label={`${name} filter`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {label}
        <Icon name="chevron-down" size={12} />
      </Button>
      {open && (
        <div className="comments-filter-menu" role="menu" aria-label={name}>
          {items.map((item, index) =>
            item === null ? (
              <div key={`divider-${index}`} className="comments-filter-divider" role="separator" />
            ) : (
              <button
                key={item.key}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                className="comments-filter-option"
                autoFocus={item.checked}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span className="comments-filter-check">{item.checked && <Icon name="check" size={14} />}</span>
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** The status filter's choices as Graphite names them; "All threads" once Clear all or Show all have cleared it. */
const STATUS_LABELS: Record<DrawerFilters['status'], string> = { open: 'Open', resolved: 'Resolved', pending: 'Added to review', all: 'All threads' };
