// PR-page pieces the shared primitives in src/ui/ do not cover: the Open / Draft / Merged / Closed state
// pill and the composer textarea.
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { PrSummary } from '../lib/model';
import { StatusPill } from '../ui/StatusPill';
import './primitives.css';

/** Open / Draft / Merged / Closed. */
export function StatePill({ pr }: { pr: Pick<PrSummary, 'state' | 'isDraft'> }) {
  if (pr.state === 'MERGED') return <StatusPill tone="done" icon="git-merge">Merged</StatusPill>;
  if (pr.state === 'CLOSED') return <StatusPill tone="danger" icon="git-pull-request-closed">Closed</StatusPill>;
  if (pr.isDraft) return <StatusPill tone="neutral" icon="git-pull-request-draft">Draft</StatusPill>;
  return <StatusPill tone="success" icon="git-pull-request">Open</StatusPill>;
}

/**
 * The textarea every composer on the page uses: ⌘↵ / Ctrl+↵ submits, Esc cancels, and it grows with
 * its content.
 */
export function CommentInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  autoFocus,
  disabled,
  minRows = 2,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  placeholder: string;
  autoFocus?: boolean;
  disabled?: boolean;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // `autoFocus` alone is not enough inside a diff: the annotation is mounted before the library slots it
  // into a rendered line, and an unrendered element cannot take focus. Retry for a few frames.
  useEffect(() => {
    if (!autoFocus) return;
    let frames = 0;
    let frame = requestAnimationFrame(function focus() {
      ref.current?.focus();
      if (document.activeElement !== ref.current && frames++ < 30) frame = requestAnimationFrame(focus);
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (value.trim()) onSubmit();
    } else if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <textarea
      ref={ref}
      className="pr-textarea"
      value={value}
      placeholder={placeholder}
      rows={Math.max(minRows, Math.min(12, value.split('\n').length))}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}
