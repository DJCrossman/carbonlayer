// PR-page pieces the shared primitives in src/ui/ do not cover: the Open / Draft / Merged / Closed state
// pill, the composer textarea, and a part of the page fed by one stage of its data.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { PrSummary } from '../lib/model';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import type { StageState } from './page-data';
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

/**
 * A part of the page fed by one stage of its data: its skeleton until the stage first arrives, then what `children`
 * renders from it. When the stage failed, a one-line error with a retry, below what it showed before if anything.
 */
export function Staged<T>({
  state,
  what,
  skeleton,
  onRetry,
  children,
}: {
  state: StageState<T>;
  /** What failed to load, in a few words: "the checks". */
  what: string;
  skeleton: ReactNode;
  onRetry: () => void;
  children: (value: T) => ReactNode;
}) {
  const failure = state.status === 'error' && <StageError what={what} error={state.error} onRetry={onRetry} />;
  if (state.value === null) return failure || skeleton;
  return (
    <>
      {children(state.value)}
      {failure}
    </>
  );
}

/** One line saying what part of the page did not load and why, with a retry. */
export function StageError({ what, error, onRetry }: { what: string; error: string; onRetry: () => void }) {
  return (
    <div className="pr-stage-error" role="alert">
      <Icon name="alert" size={14} className="pr-fg-danger" />
      <span className="pr-stage-error-text" title={error}>
        Could not load {what} <span className="pr-muted">· {error}</span>
      </span>
      <Button variant="ghost" size="sm" icon="sync" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
