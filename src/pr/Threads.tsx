// What renders inside a diff annotation: a review thread, a comment batched for the pending review, or
// the inline composer opened from the gutter "+".
import { useState } from 'react';
import type { ReviewThreadDraft } from '../app/data-source';
import type { ReviewThread } from '../lib/model';
import { Comment } from './Comment';
import type { ComposerAnchor, DiffNote } from './diff';
import { CommentInput, Icon, Kbd } from './primitives';
import './threads.css';

/** Everything a note can do; each returns whether it succeeded so the note can keep or clear its draft. */
export interface NoteActions {
  reply(threadId: string, body: string): Promise<boolean>;
  resolve(threadId: string, resolved: boolean): Promise<boolean>;
  addToReview(draft: ReviewThreadDraft): void;
  commentNow(draft: ReviewThreadDraft): Promise<boolean>;
  removePending(index: number): void;
  closeComposer(): void;
}

export function DiffNoteView({
  note,
  anchor,
  current,
  actions,
}: {
  note: DiffNote;
  anchor: ComposerAnchor | null;
  /** The thread `n` / `p` last moved to. */
  current: boolean;
  actions: NoteActions;
}) {
  switch (note.kind) {
    case 'thread':
      return <ThreadNote key={note.thread.id} thread={note.thread} current={current} actions={actions} />;
    case 'pending':
      return (
        <div className="diff-note is-pending">
          <div className="diff-note-row">
            <span className="diff-note-tag is-pending">Pending</span>
            <span className="diff-note-pending-body">{note.draft.body}</span>
            <button className="gg-btn is-small is-quiet" onClick={() => actions.removePending(note.index)} title="Remove from review">
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>
      );
    case 'composer':
      return anchor && <InlineComposer anchor={anchor} actions={actions} />;
  }
}

function ThreadNote({ thread, current, actions }: { thread: ReviewThread; current: boolean; actions: NoteActions }) {
  const [expanded, setExpanded] = useState(!thread.isResolved);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const count = thread.comments.length;

  if (!expanded) {
    return (
      <div className={`diff-note is-collapsed ${current ? 'is-current' : ''}`} data-thread-id={thread.id}>
        <button className="diff-note-summary" onClick={() => setExpanded(true)}>
          <Icon name="check-circle" size={14} className="gg-fg-success" />
          {thread.isOutdated && <span className="diff-note-tag">Outdated</span>}
          <span>
            Resolved · {count} {count === 1 ? 'comment' : 'comments'} · <span className="diff-note-show">show</span>
          </span>
        </button>
      </div>
    );
  }

  const sendReply = async () => {
    setBusy(true);
    if (await actions.reply(thread.id, reply)) setReply('');
    setBusy(false);
  };
  const toggleResolved = async () => {
    setBusy(true);
    const ok = await actions.resolve(thread.id, !thread.isResolved);
    setBusy(false);
    if (ok && !thread.isResolved) setExpanded(false);
  };

  return (
    <div className={`diff-note ${thread.isResolved ? 'is-resolved' : ''} ${current ? 'is-current' : ''}`} data-thread-id={thread.id}>
      {thread.isOutdated && (
        <div className="diff-note-outdated">
          <span className="diff-note-tag">Outdated</span>
          <pre>{thread.diffHunk}</pre>
        </div>
      )}
      {thread.comments.map((comment) => (
        <Comment key={comment.id} author={comment.author} createdAt={comment.createdAt} bodyHtml={comment.bodyHtml} url={comment.url} compact />
      ))}
      <div className="diff-note-reply">
        <CommentInput value={reply} onChange={setReply} onSubmit={sendReply} placeholder="Reply…" minRows={1} disabled={busy} />
        <div className="diff-note-actions">
          {thread.isResolved && (
            <button className="gg-btn is-small is-quiet" onClick={() => setExpanded(false)}>
              Hide
            </button>
          )}
          <button className="gg-btn is-small" onClick={toggleResolved} disabled={busy}>
            {thread.isResolved ? 'Unresolve' : 'Resolve'}
          </button>
          {reply.trim() !== '' && (
            <button className="gg-btn is-small is-primary" onClick={sendReply} disabled={busy}>
              Reply <Kbd>⌘↵</Kbd>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function InlineComposer({ anchor, actions }: { anchor: ComposerAnchor; actions: NoteActions }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const draft: ReviewThreadDraft = { path: anchor.path, line: anchor.line, side: anchor.side === 'deletions' ? 'LEFT' : 'RIGHT', body };
  const commentNow = async () => {
    setBusy(true);
    const ok = await actions.commentNow(draft);
    setBusy(false);
    if (ok) actions.closeComposer();
  };
  return (
    <div className="diff-note is-composer">
      <CommentInput
        value={body}
        onChange={setBody}
        onSubmit={commentNow}
        onCancel={actions.closeComposer}
        placeholder={`Comment on line ${anchor.side === 'deletions' ? 'L' : 'R'}${anchor.line}`}
        autoFocus
        disabled={busy}
      />
      <div className="diff-note-actions">
        <button className="gg-btn is-small is-quiet" onClick={actions.closeComposer}>
          Cancel
        </button>
        <button
          className="gg-btn is-small"
          disabled={busy || body.trim() === ''}
          onClick={() => {
            actions.addToReview(draft);
            actions.closeComposer();
          }}
        >
          Add to review
        </button>
        <button className="gg-btn is-small is-primary" disabled={busy || body.trim() === ''} onClick={commentNow}>
          Comment now <Kbd>⌘↵</Kbd>
        </button>
      </div>
    </div>
  );
}
