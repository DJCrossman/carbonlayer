// Finishing a review: the popover under "Finish review" (also opened by r c / r n / r a) that submits the
// body, the verdict and every inline comment batched with "Add to review"; and the r y quick-approve dialog.
import { useEffect, useState } from 'react';
import type { ReviewThreadDraft } from '../app/data-source';
import type { PrDetail } from '../lib/model';
import { CommentInput, Icon, Kbd } from './primitives';
import './review.css';

export type ReviewEvent = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';

export function ReviewComposer({
  pr,
  batch,
  event,
  body,
  onEventChange,
  onBodyChange,
  onRemove,
  onSubmit,
  onClose,
}: {
  pr: PrDetail;
  batch: ReviewThreadDraft[];
  event: ReviewEvent;
  body: string;
  onEventChange: (event: ReviewEvent) => void;
  onBodyChange: (body: string) => void;
  onRemove: (index: number) => void;
  onSubmit: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // GitHub rejects a "changes requested" review without a body, and a comment review with nothing in it.
  const needsBody = event === 'REQUEST_CHANGES' || (event === 'COMMENT' && batch.length === 0);
  const canSubmit = !busy && (!needsBody || body.trim() !== '');
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    await onSubmit();
    setBusy(false);
  };

  useEffect(() => {
    const onPointerDown = (pointer: PointerEvent) => {
      if (!(pointer.target instanceof Element) || !pointer.target.closest('.pr-review-anchor')) onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  return (
    <div className="review-popover" role="dialog" aria-label="Finish your review">
      <div className="review-popover-title">Finish your review</div>
      <CommentInput value={body} onChange={onBodyChange} onSubmit={submit} onCancel={onClose} placeholder="Leave a comment" autoFocus minRows={4} disabled={busy} />
      <div className="review-events" role="radiogroup" aria-label="Review verdict">
        {(
          [
            ['COMMENT', 'Comment', 'Submit general feedback without explicit approval.'],
            ['REQUEST_CHANGES', 'Request changes', 'Submit feedback that must be addressed before merging.'],
            ['APPROVE', 'Approve', 'Submit feedback and approve merging these changes.'],
          ] as const
        ).map(([value, label, hint]) => {
          const ownPr = pr.viewerDidAuthor && value !== 'COMMENT';
          return (
            <label key={value} className={`review-event ${ownPr ? 'is-disabled' : ''}`} title={ownPr ? 'You cannot approve or request changes on your own pull request' : undefined}>
              <input type="radio" name="review-event" value={value} checked={event === value} disabled={ownPr} onChange={() => onEventChange(value)} />
              <span>
                <strong>{label}</strong>
                <span className="gg-muted">{hint}</span>
              </span>
            </label>
          );
        })}
      </div>
      {batch.length > 0 && (
        <div className="review-batch">
          <div className="gg-muted">
            {batch.length} inline {batch.length === 1 ? 'comment' : 'comments'} will be included
          </div>
          <ul>
            {batch.map((draft, index) => (
              <li key={`${draft.path}:${draft.side}:${draft.line}:${index}`}>
                <span className="gg-mono review-batch-where">
                  {draft.path.split('/').at(-1)}:{draft.side === 'LEFT' ? 'L' : 'R'}
                  {draft.line}
                </span>
                <span className="review-batch-body">{draft.body}</span>
                <button className="gg-btn is-small is-quiet" onClick={() => onRemove(index)} title="Remove from review">
                  <Icon name="x" size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="review-actions">
        <button className="gg-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="gg-btn is-primary" onClick={submit} disabled={!canSubmit}>
          {busy ? 'Submitting…' : 'Submit review'} <Kbd>⌘↵</Kbd>
        </button>
      </div>
    </div>
  );
}

export function QuickApproveDialog({ pr, onConfirm, onClose }: { pr: PrDetail; onConfirm: () => Promise<boolean>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="pr-overlay" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="pr-dialog" role="alertdialog" aria-label={`Approve #${pr.number}?`}>
        <div className="pr-dialog-title">
          <Icon name="check-circle" size={16} className="gg-fg-success" />
          Approve #{pr.number}?
        </div>
        <p className="gg-muted">{pr.title}</p>
        <div className="review-actions">
          <button className="gg-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="gg-btn is-primary"
            autoFocus
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              if (await onConfirm()) onClose();
              setBusy(false);
            }}
          >
            {busy ? 'Approving…' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}
