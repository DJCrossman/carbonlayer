// Hiding a comment, as GitHub's comment menu does: a reason, which GitHub shows to others, then "Hide comment".
import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { HIDE_REASONS, type HideReason } from '../lib/model';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

/** GitHub's names for its reasons, as its Hide menu lists them (its bundle, 2026-11-16). */
const HIDE_REASON_LABELS: Record<HideReason, string> = {
  SPAM: 'Spam',
  ABUSE: 'Abuse',
  OFF_TOPIC: 'Off-topic',
  OUTDATED: 'Outdated',
  DUPLICATE: 'Duplicate',
  RESOLVED: 'Resolved',
  LOW_QUALITY: 'Low quality',
};

/**
 * The dialog the comment menu's Hide opens: "Choose a reason for hiding this comment", GitHub's reasons in its order, and
 * "Hide comment" once one is chosen. Esc, Cancel or a click outside close it; while GitHub hides the comment it takes no
 * input, and it closes once GitHub has, staying open should GitHub refuse. Drawn over the whole page, wherever the comment is
 * (inside a diff too).
 */
export function HideCommentDialog({ onHide, onClose }: { onHide: (reason: HideReason) => Promise<boolean>; onClose: () => void }) {
  const [reason, setReason] = useState<HideReason | null>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const close = () => {
    if (!busy) onClose();
  };
  const hide = async () => {
    if (!reason || busy) return;
    setBusy(true);
    const hidden = await onHide(reason);
    setBusy(false);
    if (hidden) onClose();
  };
  return createPortal(
    <div className="pr-overlay" onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div
        className="pr-dialog hide-comment"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          // The page's own shortcuts stay out of the dialog.
          event.stopPropagation();
          if (event.key !== 'Escape') return;
          event.preventDefault();
          close();
        }}
      >
        <div className="pr-dialog-title" id={titleId}>
          <Icon name="eye-closed" size={16} />
          Choose a reason for hiding this comment
        </div>
        <p className="pr-muted">The reason will be displayed to others.</p>
        <div className="hide-comment-reasons" role="radiogroup" aria-labelledby={titleId}>
          {HIDE_REASONS.map((candidate, index) => (
            <label key={candidate} className="hide-comment-reason">
              <input
                type="radio"
                name={`${titleId}-reason`}
                value={candidate}
                checked={reason === candidate}
                disabled={busy}
                autoFocus={index === 0}
                onChange={() => setReason(candidate)}
              />
              {HIDE_REASON_LABELS[candidate]}
            </label>
          ))}
        </div>
        <div className="review-actions">
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !reason} onClick={() => void hide()}>
            {busy ? 'Hiding…' : 'Hide comment'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
