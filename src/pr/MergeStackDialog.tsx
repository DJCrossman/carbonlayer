// Merging a GitHub-native stack in Graphite's dialog: "Merge stack of N PRs into <trunk>", the merge strategy, the PRs it
// merges (this one first, then down the stack) and the button that merges them all in GitHub's one request
// (`enqueue_stack`, docs/research/github-web-mutations.md). The top bar's and the sidebar's "Merge N PRs" open it, and m.
import { useEffect, useId, useRef, useState } from 'react';
import { mergeMethodSchema, type PrDetail, type StackEntry } from '../lib/model';
import type { MergeCommit, MergeMethod } from '../lib/rpc';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { Skeleton } from '../ui/Skeleton';
import { MERGE_LABELS } from './Sidebar';
import './merge-stack.css';

/**
 * The dialog that merges the stack up to this PR. GitHub's own stack merge takes a commit's text only for a merge commit,
 * this PR's, so only this PR's row offers "Commit details", and only then. Esc and ✕ close it and ⌘↵ (Ctrl+↵ off macOS)
 * merges; the focus goes round inside it while it is open, and back to what had it once it closes.
 */
export function MergeStackDialog({
  pr,
  prs,
  method: openedWith,
  proposeCommit,
  onMerge,
  onClose,
}: {
  pr: PrDetail;
  /** The open PRs the merge merges, bottom first and this one last (`stackToMerge`). */
  prs: StackEntry[];
  /** The method it opens with: the one picked in the sidebar, else the one the viewer prefers. */
  method: MergeMethod;
  /** The merge commit GitHub proposes for this PR merged this way. */
  proposeCommit: (method: MergeMethod) => Promise<MergeCommit>;
  /** Merges, with the merge commit the viewer wrote when there is one; resolves false when it did not, after saying why. */
  onMerge: (method: MergeMethod, commit?: MergeCommit) => Promise<boolean>;
  onClose: () => void;
}) {
  const [method, setMethod] = useState(openedWith);
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // This PR's merge commit: GitHub's proposal once it has come, then as the viewer edits it.
  const [commit, setCommit] = useState<MergeCommit | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const latest = useRef({ proposeCommit });
  latest.current = { proposeCommit };
  const titleId = useId();
  const strategyId = useId();
  const detailsId = useId();
  const takesCommit = method === 'MERGE';
  const isMac = navigator.userAgent.includes('Mac');

  // What had the focus as it opened, before its close button took it, gets it back once the dialog has gone.
  const [opener] = useState(() => document.activeElement);
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    },
    [opener],
  );

  // GitHub's proposal for this PR's merge commit, asked for when its details are first opened.
  useEffect(() => {
    if (!takesCommit || !detailsOpen || commit) return;
    let current = true;
    setCommitError(null);
    latest.current.proposeCommit('MERGE').then(
      (proposed) => current && setCommit(proposed),
      (reason: unknown) => current && setCommitError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      current = false;
    };
  }, [takesCommit, detailsOpen, commit]);

  // A merge GitHub has started goes on whatever the page does, so the dialog stays until GitHub says how it went.
  const close = () => {
    if (!busy) onClose();
  };

  async function merge() {
    if (busy) return;
    setBusy(true);
    const merged = await onMerge(method, takesCommit && commit ? commit : undefined);
    setBusy(false);
    if (merged) onClose();
  }

  return (
    <div className="pr-overlay" onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div
        className="pr-dialog merge-stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          // The page's own shortcuts stay out of the dialog.
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          } else if (event.key === 'Enter' && (isMac ? event.metaKey : event.ctrlKey)) {
            event.preventDefault();
            void merge();
          } else if (event.key === 'Tab') {
            const focusable = [...event.currentTarget.querySelectorAll('button, select, input, textarea')].filter(
              (element): element is HTMLElement => element instanceof HTMLElement && !element.matches(':disabled'),
            );
            const first = focusable[0];
            const last = focusable.at(-1);
            const leaving = event.shiftKey ? document.activeElement === first || document.activeElement === event.currentTarget : document.activeElement === last;
            if (!leaving) return;
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
          }
        }}
      >
        <div className="merge-stack-head">
          <h2 id={titleId} className="merge-stack-title">
            Merge stack of {prs.length} PRs into <code className="pr-mono">{pr.stack.trunk}</code>
          </h2>
          <Kbd>m</Kbd>
          <Button variant="ghost" size="sm" icon="x" aria-label="Close" title="Close (Esc)" autoFocus disabled={busy} onClick={close} />
        </div>
        <p className="merge-stack-intro">
          You are about to merge a stack of {prs.length} PRs at once, from the PR closest to "{pr.stack.trunk}" up to this PR.
        </p>
        <div className="merge-stack-section">
          <div className="merge-stack-label">
            <label htmlFor={strategyId}>Merge strategy</label>
            {/* What GitHub's merge box says each way does to a stack. */}
            <Icon
              name="info"
              size={14}
              title={
                {
                  MERGE: `All commits from these ${prs.length} branches will be added to the base branch via merge commits.`,
                  SQUASH: `The commits from these ${prs.length} branches will be combined into one commit per branch in the base branch.`,
                  REBASE: `All commits from these ${prs.length} branches will be rebased and added to the base branch.`,
                }[method]
              }
            />
          </div>
          <div className="merge-stack-strategy">
            <Icon name="git-merge" size={14} />
            <select id={strategyId} className="pr-select" value={method} disabled={busy} onChange={(event) => setMethod(mergeMethodSchema.parse(event.currentTarget.value))}>
              {pr.allowedMergeMethods.map((allowed) => (
                <option key={allowed} value={allowed}>
                  {MERGE_LABELS[allowed].verb}
                </option>
              ))}
            </select>
          </div>
        </div>
        <ul className="merge-stack-prs" aria-label="Pull requests to merge">
          {[...prs].reverse().map((entry) => {
            const ownCommit = takesCommit && entry.number === pr.number;
            return (
              <li key={entry.number} className="merge-stack-pr">
                <div className="merge-stack-pr-line">
                  <Icon name="check-circle" size={16} className="pr-fg-success" />
                  <span className="merge-stack-pr-title">
                    {entry.title} (#{entry.number})
                  </span>
                  {ownCommit && (
                    <button type="button" className="merge-stack-details" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen((open) => !open)}>
                      Commit details
                      <Icon name="chevron-down" size={14} />
                    </button>
                  )}
                </div>
                {ownCommit && detailsOpen && (
                  <div id={detailsId} className="merge-stack-commit">
                    {commit ? (
                      <>
                        <label className="merge-stack-field">
                          Commit message
                          <input
                            type="text"
                            value={commit.commitTitle}
                            disabled={busy}
                            onChange={({ currentTarget: { value } }) => setCommit((current) => current && { ...current, commitTitle: value })}
                          />
                        </label>
                        <label className="merge-stack-field">
                          Extended description
                          <textarea
                            rows={4}
                            placeholder="Add an optional extended description…"
                            value={commit.commitMessage}
                            disabled={busy}
                            onChange={({ currentTarget: { value } }) => setCommit((current) => current && { ...current, commitMessage: value })}
                          />
                        </label>
                      </>
                    ) : commitError ? (
                      <p className="merge-stack-note" role="alert">
                        Could not load the commit GitHub proposes: {commitError}
                      </p>
                    ) : (
                      <>
                        <Skeleton width="100%" height={28} />
                        <Skeleton width="100%" height={72} />
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="merge-stack-foot">
          <Button variant="primary" disabled={busy} onClick={() => void merge()}>
            {busy ? 'Merging…' : `${MERGE_LABELS[method].verb} ${prs.length} PRs`} <Kbd>⌘↵</Kbd>
          </Button>
        </div>
      </div>
    </div>
  );
}
