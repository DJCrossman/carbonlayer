// What renders inside a diff annotation: a review thread, a comment batched for the pending review, or
// the inline composer opened from the gutter "+".
import { useEffect, useState } from 'react';
import type { ReviewThreadDraft } from '../app/data-source';
import type { ReviewThread } from '../lib/model';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { Comment } from './Comment';
import type { ComposerAnchor, DiffNote } from './diff';
import { CommentInput } from './primitives';
import { Reactions } from './Reactions';
import './threads.css';

export function DiffNoteView({
  note,
  anchor,
  suggestion,
  current,
  actions,
}: {
  note: DiffNote;
  anchor: ComposerAnchor | null;
  /** The commented lines' current text, when GitHub would offer a suggestion for them (right-side lines). */
  suggestion: string | null;
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
            <Button variant="ghost" size="sm" onClick={() => actions.removePending(note.index)} title="Remove from review">
              <Icon name="x" size={14} />
            </Button>
          </div>
        </div>
      );
    case 'composer':
      return anchor && <InlineComposer anchor={anchor} suggestion={suggestion} actions={actions} />;
  }
}

/** Everything a note can do; each returns whether it succeeded so the note can keep or clear its draft. */
export interface NoteActions {
  reply(threadId: string, body: string): Promise<boolean>;
  resolve(threadId: string, resolved: boolean): Promise<boolean>;
  addToReview(draft: ReviewThreadDraft): void;
  commentNow(draft: ReviewThreadDraft): Promise<boolean>;
  removePending(index: number): void;
  closeComposer(): void;
}

function ThreadNote({ thread, current, actions }: { thread: ReviewThread; current: boolean; actions: NoteActions }) {
  const [expanded, setExpanded] = useState(!thread.isResolved);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const count = thread.comments.length;

  // Moving to a thread (n / p, a review's "inline comments" link) opens it even when resolved.
  useEffect(() => {
    if (current) setExpanded(true);
  }, [current]);

  if (!expanded) {
    return (
      <div className={`diff-note is-collapsed ${current ? 'is-current' : ''}`} data-thread-id={thread.id}>
        <button className="diff-note-summary" onClick={() => setExpanded(true)}>
          <Icon name="check-circle-fill" size={14} className="pr-fg-success" />
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
        <Comment
          key={comment.id}
          author={comment.author}
          createdAt={comment.createdAt}
          bodyHtml={comment.bodyHtml}
          url={comment.url}
          footer={<Reactions subjectId={comment.subjectId} reactions={comment.reactions} />}
          compact
        />
      ))}
      <div className="diff-note-reply">
        <CommentInput value={reply} onChange={setReply} onSubmit={sendReply} placeholder="Reply…" minRows={1} disabled={busy} />
        <div className="diff-note-actions">
          {thread.isResolved && (
            <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Hide
            </Button>
          )}
          <Button size="sm" onClick={toggleResolved} disabled={busy}>
            {thread.isResolved ? 'Unresolve' : 'Resolve'}
          </Button>
          {reply.trim() !== '' && (
            <Button variant="primary" size="sm" onClick={sendReply} disabled={busy}>
              Reply <Kbd>⌘↵</Kbd>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function InlineComposer({ anchor, suggestion, actions }: { anchor: ComposerAnchor; suggestion: string | null; actions: NoteActions }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const draft: ReviewThreadDraft = {
    path: anchor.path,
    line: anchor.line,
    side: anchor.side === 'deletions' ? 'LEFT' : 'RIGHT',
    ...(anchor.startLine !== undefined && { startLine: anchor.startLine, startSide: anchor.startSide === 'deletions' ? 'LEFT' : 'RIGHT' }),
    body,
  };
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
        placeholder={
          draft.startLine === undefined
            ? `Comment on line ${draft.side === 'LEFT' ? 'L' : 'R'}${draft.line}`
            : `Comment on lines ${draft.startSide === 'LEFT' ? 'L' : 'R'}${draft.startLine}–${draft.side === 'LEFT' ? 'L' : 'R'}${draft.line}`
        }
        autoFocus
        disabled={busy}
        suggestion={suggestion === null ? undefined : () => suggestion}
      />
      <div className="diff-note-actions">
        <Button variant="ghost" size="sm" onClick={actions.closeComposer}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={busy || body.trim() === ''}
          onClick={() => {
            actions.addToReview(draft);
            actions.closeComposer();
          }}
        >
          Add to review
        </Button>
        <Button variant="primary" size="sm" disabled={busy || body.trim() === ''} onClick={commentNow}>
          Comment now <Kbd>⌘↵</Kbd>
        </Button>
      </div>
    </div>
  );
}
