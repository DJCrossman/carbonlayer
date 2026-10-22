// The right sidebar: status (with Merge when ready), the one next step, checks, reviewers (Reviewers.tsx), labels
// (Labels.tsx) and assignees (Assignees.tsx). Each card shows a skeleton until the stage it comes from arrives; cards with
// nothing to show are left out, except an open PR's checks, which says why it has none, and the labels and assignees of a
// PR the viewer can edit, which offer to add some.
import { useEffect, useState, type ReactNode } from 'react';
import type { MergeMethod } from '../lib/rpc';
import { mergeMethodSchema, type PrDetail, type PrStage, type StackEntry } from '../lib/model';
import { isUnderWay, type StackMerge } from '../lib/stack-merges';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { RelativeTime } from '../ui/RelativeTime';
import { Skeleton } from '../ui/Skeleton';
import type { CheckReruns } from './check-reruns';
import { followLink, goToPr } from './navigation';
import { nextActionFor } from './next-action';
import type { PrPageData } from './page-data';
import { StatePill, Staged } from './primitives';
import './sidebar.css';

export function Sidebar({
  pr,
  data,
  onRetry,
  mergeMethod,
  onAutoMerge,
  onRevert,
  onMarkReady,
  onMerge,
  onMergeStack,
  backgroundMerge,
  onDropBackgroundMerge,
  onRebaseStack,
  onViewThreads,
  checkReruns,
  reviewersCard,
  labelsCard,
  assigneesCard,
  actions,
}: {
  pr: PrDetail;
  /** The stages the cards come from: the merge box (status, next step, reviewers), checks, labels and assignees. */
  data: PrPageData;
  onRetry: (stages: PrStage[]) => void;
  /** The method the viewer prefers, already narrowed to what the repository allows. */
  mergeMethod: MergeMethod;
  onAutoMerge: (enabled: boolean, method: MergeMethod) => Promise<boolean>;
  /** Reverts the merged PR; resolves false when it did not, after saying why. */
  onRevert: () => Promise<boolean>;
  onMarkReady: () => Promise<boolean>;
  onMerge: (method: MergeMethod) => Promise<boolean>;
  /** Opens the dialog that merges the stack (MergeStackDialog.tsx), with the method picked here. */
  onMergeStack: (method: MergeMethod) => void;
  /**
   * The merge of this PR's stack CarbonLayer runs in the background (src/lib/stack-merges.ts), under way or stopped: the
   * merge dialog's stands where the merge controls would, and one merging when ready shows as "Merge when ready".
   */
  backgroundMerge: StackMerge | null;
  /** Cancels that merge, or dismisses it once stopped; resolves false when it could not, after saying why. */
  onDropBackgroundMerge: (id: string) => Promise<boolean>;
  /** Rebases the PR's native stack onto its base branch, as GitHub's "Rebase stack" does; resolves false when it did not. */
  onRebaseStack: () => Promise<boolean>;
  onViewThreads: () => void;
  checkReruns: CheckReruns;
  /** The Reviewers card (Reviewers.tsx), wired to the page's data source. */
  reviewersCard: ReactNode;
  /** The Labels card (Labels.tsx), wired to the page's data source. */
  labelsCard: ReactNode;
  /** The Assignees card (Assignees.tsx), wired to the page's data source. */
  assigneesCard: ReactNode;
  /** The header's actions again, under the reviewers, while the header's are out of sight (PrPage's PrActions). */
  actions: ReactNode;
}) {
  return (
    <aside className="pr-sidebar" aria-label="Status">
      <StatusCard
        pr={pr}
        mergeMethod={mergeMethod}
        onAutoMerge={onAutoMerge}
        onRevert={onRevert}
        ownMergeWhenReady={backgroundMerge?.whenReady ? backgroundMerge : null}
        onDropBackgroundMerge={onDropBackgroundMerge}
      />
      {/* GitHub's merge box says so of a stack behind its base branch, which merges all the same. */}
      {pr.stackSection?.kind === 'rebase-optional' && (
        <Card className="side-card side-action is-attention">
          <div className="side-action-title">
            <Icon name="alert" size={16} />
            <span>This stack is out-of-date with its base branch</span>
          </div>
          <div className="side-action-detail">Rebase this stack onto the latest version of {pr.stackSection.baseRefName}.</div>
          {pr.stackSection.viewerCanRebase && <RebaseStack onRebaseStack={onRebaseStack} />}
        </Card>
      )}
      {/* While CarbonLayer merges the stack from the dialog, or once that stopped, it stands where the merge controls would. */}
      {backgroundMerge && !backgroundMerge.whenReady ? (
        <BackgroundMergeCard merge={backgroundMerge} onDrop={() => onDropBackgroundMerge(backgroundMerge.id)} />
      ) : (
        <ActionCard
          pr={pr}
          data={data}
          onRetry={onRetry}
          mergeMethod={mergeMethod}
          onMarkReady={onMarkReady}
          onMerge={onMerge}
          onMergeStack={onMergeStack}
          onRebaseStack={onRebaseStack}
          onViewThreads={onViewThreads}
        />
      )}
      <Staged state={data.checks} what="the checks" onRetry={() => onRetry(['checks'])} skeleton={<SideCardSkeleton title="Checks" rows={3} />}>
        {({ emptyReason }) =>
          pr.ci.checks.length > 0 ? (
            <ChecksCard pr={pr} reruns={checkReruns} />
          ) : (
            pr.state === 'OPEN' && (
              <Card className="side-card">
                <h3 className="side-card-title">
                  Checks <span className="pr-muted">· none</span>
                </h3>
                {emptyReason && <p className="pr-muted side-checks-empty">{emptyReason}</p>}
              </Card>
            )
          )
        }
      </Staged>
      <Staged state={data.mergeBox} what="the reviewers" onRetry={() => onRetry(['mergeBox'])} skeleton={<SideCardSkeleton title="Reviewers" rows={2} />}>
        {() => reviewersCard}
      </Staged>
      {actions}
      <Staged
        state={data.meta}
        what="labels and assignees"
        onRetry={() => onRetry(['meta'])}
        skeleton={
          <>
            <SideCardSkeleton title="Labels" rows={1} />
            <SideCardSkeleton title="Assignees" rows={1} />
          </>
        }
      >
        {() => (
          <>
            {labelsCard}
            {/* The inbox's row, which stands in for the stage until it answers, does not say who is assigned. */}
            {data.meta.status !== 'placeholder' && assigneesCard}
          </>
        )}
      </Staged>
    </aside>
  );
}

function StatusCard({
  pr,
  mergeMethod,
  onAutoMerge,
  onRevert,
  ownMergeWhenReady,
  onDropBackgroundMerge,
}: {
  pr: PrDetail;
  mergeMethod: MergeMethod;
  onAutoMerge: (enabled: boolean, method: MergeMethod) => Promise<boolean>;
  onRevert: () => Promise<boolean>;
  /**
   * CarbonLayer's own "Merge when ready" for this PR's stack, armed where GitHub refused its stack auto-merge to the
   * repository: under way, which shows the switch on, or stopped, which says why until it is dismissed.
   */
  ownMergeWhenReady: StackMerge | null;
  onDropBackgroundMerge: (id: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  // Reverting creates a branch on GitHub, so it asks first.
  const [revert, setRevert] = useState<'idle' | 'confirming' | 'reverting'>('idle');
  // The method Merge when ready merges with: auto-merge's own while it is on (GitHub's or CarbonLayer's), else the one
  // picked here.
  const [picked, setPicked] = useState(mergeMethod);
  const armed = ownMergeWhenReady && isUnderWay(ownMergeWhenReady) ? ownMergeWhenReady : null;
  const on = pr.autoMerge !== null || armed !== null;
  const method = armed?.method ?? pr.autoMerge?.method ?? picked;
  const methods = pr.allowedMergeMethods.length > 0 ? pr.allowedMergeMethods : (['SQUASH', 'MERGE', 'REBASE'] as const);
  // Who merged or closed it comes from the last such event in the timeline.
  const ending = pr.state === 'OPEN' ? undefined : pr.timeline.findLast((item) => item.kind === (pr.state === 'MERGED' ? 'merged' : 'closed'));
  const endedBy = ending && 'actor' in ending ? ending.actor : null;
  const endedAt = pr.mergedAt ?? (ending && 'createdAt' in ending ? ending.createdAt : null);
  // GitHub's merge box will not turn auto-merge on while the stack's branches keep it from merging; the next step says why.
  const stackBlocks = pr.stackSection !== null && pr.stackSection.kind !== 'rebase-optional';
  // In a GitHub-native stack, auto-merge also merges the open PRs below this one that are not queued already.
  const mergingWithIt = pr.stack.source === 'native' ? pr.stack.entries.slice(0, pr.stack.currentIndex).filter((entry) => entry.state === 'OPEN' && !entry.isInMergeQueue).length : 0;
  return (
    <Card className="side-card side-status">
      <div className="side-status-line">
        <StatePill pr={pr} />
        {pr.state === 'OPEN' ? (
          <span className="pr-muted side-status-into">
            into <span className="pr-mono">{pr.baseRefName}</span>
          </span>
        ) : (
          <span className="pr-muted">
            {endedBy && `by ${endedBy.login} `}
            {endedAt && <RelativeTime date={endedAt} ago />}
          </span>
        )}
        {pr.state === 'MERGED' && pr.viewerCanUpdate && revert === 'idle' && (
          <Button size="sm" className="side-status-revert" title="Make a branch that undoes this pull request, and open its pull request" onClick={() => setRevert('confirming')}>
            Revert
          </Button>
        )}
      </div>
      {revert !== 'idle' && (
        <div className="revert-confirm">
          <div>
            Create a branch that undoes <strong>#{pr.number}</strong>, then open its pull request on GitHub?
          </div>
          <div className="merge-row">
            <Button onClick={() => setRevert('idle')} disabled={revert === 'reverting'}>
              Cancel
            </Button>
            <Button
              variant="primary"
              autoFocus
              disabled={revert === 'reverting'}
              onClick={async () => {
                setRevert('reverting');
                // On success the page moves on to GitHub's; on failure it stays, with the reason in a toast.
                if (!(await onRevert())) setRevert('confirming');
              }}
            >
              {revert === 'reverting' ? 'Reverting…' : 'Revert'}
            </Button>
          </div>
        </div>
      )}
      {pr.state === 'OPEN' && (pr.viewerCanEnableAutoMerge || on) && (
        <div className="side-switch-row">
          <label className="side-switch" title={stackBlocks && !on ? 'Merging is blocked due to failing stack merge requirements' : undefined}>
            <input
              type="checkbox"
              role="switch"
              checked={on}
              disabled={busy || (stackBlocks && !on)}
              onChange={async (event) => {
                setBusy(true);
                await onAutoMerge(event.target.checked, method);
                setBusy(false);
              }}
            />
            <span className="side-switch-track" aria-hidden="true" />
            <span>Merge when ready</span>
          </label>
          <select
            className="pr-select side-switch-method"
            value={method}
            disabled={busy}
            aria-label="Merge when ready with"
            onChange={async (event) => {
              const chosen = mergeMethodSchema.parse(event.currentTarget.value);
              setPicked(chosen);
              // While it is on, a new method applies at once.
              if (!on) return;
              setBusy(true);
              await onAutoMerge(true, chosen);
              setBusy(false);
            }}
          >
            {methods.map((allowed) => (
              <option key={allowed} value={allowed}>
                {MERGE_LABELS[allowed].short}
              </option>
            ))}
          </select>
        </div>
      )}
      {pr.state === 'OPEN' && pr.autoMerge !== null && mergingWithIt > 0 && (
        <p className="pr-muted side-checks-empty">
          This pull request and {mergingWithIt} {mergingWithIt === 1 ? 'other' : 'others'} in the stack will automatically merge when they all meet the merge requirements.
        </p>
      )}
      {/* CarbonLayer's own, in place of GitHub's stack auto-merge: who merges the stack and why, and where it is. */}
      {armed && (
        <p className="pr-muted side-checks-empty side-merge-when-ready">
          {armed.step.kind === 'merging' ? 'Merging… ' : armed.step.kind === 'waiting' && armed.step.for?.kind === 'stack-rebase' ? 'Waiting for the stack to be rebased. ' : ''}
          CarbonLayer will merge this stack when it's ready: GitHub's stack auto-merge isn't available for this repository.
        </p>
      )}
      {armed?.trouble && (
        <p className="side-checks-empty side-merge-trouble" title={armed.trouble}>
          {armed.trouble}
        </p>
      )}
      {ownMergeWhenReady?.step.kind === 'stopped' && (
        <StoppedMergeWhenReady reason={ownMergeWhenReady.step.reason} onDismiss={() => onDropBackgroundMerge(ownMergeWhenReady.id)} />
      )}
    </Card>
  );
}

function ActionCard({
  pr,
  data,
  onRetry,
  mergeMethod,
  onMarkReady,
  onMerge,
  onMergeStack,
  onRebaseStack,
  onViewThreads,
}: {
  pr: PrDetail;
  data: PrPageData;
  onRetry: (stages: PrStage[]) => void;
  mergeMethod: MergeMethod;
  onMarkReady: () => Promise<boolean>;
  onMerge: (method: MergeMethod) => Promise<boolean>;
  onMergeStack: (method: MergeMethod) => void;
  onRebaseStack: () => Promise<boolean>;
  onViewThreads: () => void;
}) {
  // The stages the next step depends on that have not arrived, loading or failed; what the inbox showed does not decide it.
  const unknown = (['mergeBox', 'stack', 'threads', 'checks'] as const).filter((stage) => data[stage].value === null || data[stage].status === 'placeholder');
  const action = nextActionFor(pr, unknown);
  const [busy, setBusy] = useState(false);
  if (action.kind === 'checking') {
    const failed = unknown.flatMap((stage) => {
      const state = data[stage];
      return state.status === 'error' ? [{ stage, error: state.error }] : [];
    });
    const [firstFailure] = failed;
    return (
      <Card className={`side-card side-action ${firstFailure ? 'is-danger' : 'is-neutral is-checking'}`}>
        {firstFailure ? (
          <div className="side-action-title" role="alert">
            <Icon name="alert" size={16} />
            <span className="side-action-failed" title={firstFailure.error}>
              Could not check mergeability <span className="pr-muted">· {firstFailure.error}</span>
            </span>
            <Button variant="ghost" size="sm" icon="sync" onClick={() => onRetry(failed.map(({ stage }) => stage))}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="side-action-title pr-muted">
              <Icon name="clock" size={16} />
              <span>{action.title}</span>
            </div>
            <Skeleton width="70%" height={10} />
          </>
        )}
      </Card>
    );
  }
  const failingCheck = pr.ci.checks.find((check) => check.state === 'FAILURE');
  const icon = ({ success: 'check-circle-fill', danger: 'x-circle-fill', attention: 'clock', neutral: 'git-pull-request-draft', done: 'git-merge' } as const)[action.tone];
  return (
    <Card className={`side-card side-action is-${action.tone}`}>
      <div className="side-action-title">
        <Icon name={icon} size={16} />
        <span>{action.title}</span>
      </div>
      {action.detail && <div className="side-action-detail">{action.detail}</div>}
      {action.kind === 'draft' && pr.viewerCanUpdate && (
        <Button
          className="side-action-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onMarkReady();
            setBusy(false);
          }}
        >
          Ready for review
        </Button>
      )}
      {action.kind === 'downstack' && (
        <Button className="side-action-button" onClick={() => goToPr(action.pr)}>
          Go to #{action.pr.number}
        </Button>
      )}
      {action.kind === 'stack-rebase' && pr.stackSection?.viewerCanRebase && <RebaseStack onRebaseStack={onRebaseStack} />}
      {action.kind === 'unresolved' && (
        <Button className="side-action-button" onClick={onViewThreads} title="Next unresolved thread (n)">
          View comments
        </Button>
      )}
      {action.kind === 'checks-failed' && failingCheck?.url && (
        <a
          className="gg-btn gg-btn--default gg-btn--md side-action-button"
          href={failingCheck.url}
          onClick={(event) => {
            // The run opens in this tab, like GitHub's own check links; ⌘, Ctrl, Shift or Alt leave it to the browser.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            followLink(event.currentTarget.href);
          }}
        >
          View check
        </a>
      )}
      {action.kind === 'ready' && <MergeControls pr={pr} mergeMethod={mergeMethod} onMerge={onMerge} onMergeStack={onMergeStack} />}
      {action.kind === 'ready-as-stack' && <MergeControls pr={pr} stack={action.prs} mergeMethod={mergeMethod} onMerge={onMerge} onMergeStack={onMergeStack} />}
    </Card>
  );
}

function MergeControls({
  pr,
  stack,
  mergeMethod,
  onMerge,
  onMergeStack,
}: {
  pr: PrDetail;
  /** The open PRs a merge as a stack merges, bottom first and this one last; absent when this PR merges alone. */
  stack?: StackEntry[];
  mergeMethod: MergeMethod;
  onMerge: (method: MergeMethod) => Promise<boolean>;
  onMergeStack: (method: MergeMethod) => void;
}) {
  const [method, setMethod] = useState(mergeMethod);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (confirming) {
    return (
      <div className="merge-confirm">
        <div>
          {MERGE_LABELS[method].verb} <strong>#{pr.number}</strong> into <span className="pr-mono">{pr.baseRefName}</span>?
        </div>
        <div className="merge-row">
          <Button onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="pr-merge-button"
            autoFocus
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onMerge(method);
              setBusy(false);
              if (ok) setConfirming(false);
            }}
          >
            {busy ? 'Merging…' : 'Confirm merge'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="merge-row">
      <select className="pr-select" value={method} onChange={(event) => setMethod(mergeMethodSchema.parse(event.currentTarget.value))} aria-label="Merge method">
        {pr.allowedMergeMethods.map((allowed) => (
          <option key={allowed} value={allowed}>
            {MERGE_LABELS[allowed].short}
          </option>
        ))}
      </select>
      <Button
        variant="primary"
        className="pr-merge-button"
        disabled={!pr.viewerCanMerge}
        title={pr.viewerCanMerge ? undefined : 'You do not have permission to merge this pull request'}
        // A stack is merged from its dialog, which names every PR it merges; this PR alone confirms here.
        onClick={() => (stack ? onMergeStack(method) : setConfirming(true))}
      >
        <Icon name="git-merge" size={14} />
        {stack ? `Merge ${stack.length} PRs` : 'Merge'}
      </Button>
    </div>
  );
}

/**
 * GitHub's "Rebase stack". It asks first, as GitHub's does, in the words of GitHub's dialog: every branch of the stack is
 * rebased and force-pushed.
 */
function RebaseStack({ onRebaseStack }: { onRebaseStack: () => Promise<boolean> }) {
  const [state, setState] = useState<'idle' | 'confirming' | 'rebasing'>('idle');
  if (state === 'idle') {
    return (
      <Button className="side-action-button" onClick={() => setState('confirming')}>
        Rebase stack
      </Button>
    );
  }
  return (
    <div className="revert-confirm">
      <div>Each branch is rebased onto the tip of the one below it, starting from the first unmerged branch. Once a branch is rebased, it is force-pushed.</div>
      <div className="merge-row">
        <Button onClick={() => setState('idle')} disabled={state === 'rebasing'}>
          Cancel
        </Button>
        <Button
          variant="primary"
          autoFocus
          disabled={state === 'rebasing'}
          onClick={async () => {
            setState('rebasing');
            // Once rebased, the page reloads and GitHub says whether the stack still needs it; on failure the reason is in a toast.
            setState((await onRebaseStack()) ? 'idle' : 'confirming');
          }}
        >
          {state === 'rebasing' ? 'Rebasing stack…' : 'Rebase stack'}
        </Button>
      </div>
    </div>
  );
}

function ChecksCard({ pr, reruns }: { pr: PrDetail; reruns: CheckReruns }) {
  const [showPassed, setShowPassed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { checks } = pr.ci;
  const passed = checks.filter((check) => check.state === 'SUCCESS');
  // Failing first, then running, then everything else.
  const urgency = (state: string) => (state === 'FAILURE' || state === 'CANCELLED' ? 0 : state === 'PENDING' ? 1 : 2);
  const sorted = [...checks].sort((a, b) => urgency(a.state) - urgency(b.state));
  const hidePassed = checks.length > 8 && !showPassed;
  const visible = hidePassed ? sorted.filter((check) => check.state !== 'SUCCESS') : sorted;
  const segments = [
    ['success', passed.length],
    ['danger', checks.filter((check) => urgency(check.state) === 0).length],
    ['attention', checks.filter((check) => check.state === 'PENDING').length],
  ] as const;
  const other = checks.length - segments.reduce((sum, [, count]) => sum + count, 0);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.checks-rerun-menu')) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <Card className="side-card">
      <div className="side-card-head">
        <h3 className="side-card-title">
          Checks{' '}
          <span className="pr-muted">
            · {passed.length}/{checks.length} passed
          </span>
        </h3>
        {reruns.failedRunIds.length > 0 && (
          <>
            <Button variant="ghost" size="sm" icon="sync" disabled={reruns.running} title="Re-run the failed jobs of each failing workflow run (c r)" onClick={() => void reruns.rerun('failed')}>
              {reruns.running ? 'Re-running…' : 'Re-run failed'}
            </Button>
            <div className="pr-menu checks-rerun-menu">
              <Button
                variant="ghost"
                size="sm"
                icon="kebab-horizontal"
                aria-label="More re-run options"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={reruns.running}
                onClick={() => setMenuOpen((open) => !open)}
              />
              {menuOpen && (
                <div className="pr-menu-list" role="menu">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      void reruns.rerun('all');
                    }}
                  >
                    <Icon name="sync" size={14} />
                    Re-run all jobs
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div className="checks-bar" aria-hidden="true">
        {[...segments, ['neutral', other] as const].map(([tone, count]) =>
          count > 0 ? <span key={tone} className={`is-${tone}`} style={{ flexGrow: count }} /> : null,
        )}
      </div>
      <ul className="side-list checks-list">
        {visible.map((check) => {
          const seconds =
            check.startedAt && check.completedAt ? Math.round((Date.parse(check.completedAt) - Date.parse(check.startedAt)) / 1000) : null;
          const [icon, tone] =
            check.state === 'SUCCESS'
              ? (['check-circle-fill', 'success'] as const)
              : urgency(check.state) === 0
                ? (['x-circle-fill', 'danger'] as const)
                : check.state === 'PENDING'
                  ? (['dot-fill', 'attention'] as const)
                  : (['skip', 'muted'] as const);
          return (
            <li key={`${check.group ?? ''}/${check.name}`}>
              <a
                className="check-row"
                href={check.url ?? undefined}
                title={check.description ?? undefined}
                onClick={(event) => {
                  // The run opens in this tab, like GitHub's own check links; ⌘, Ctrl, Shift or Alt leave it to the browser.
                  if (!event.currentTarget.href || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  followLink(event.currentTarget.href);
                }}
              >
                <Icon name={icon} size={14} className={`pr-fg-${tone}`} />
                <span className="check-name">{check.name}</span>
                {check.group && <span className="check-group pr-muted">{check.group}</span>}
                {pr.requiredCheckNames.includes(check.name) && <span className="check-required">Required</span>}
                {seconds !== null && (
                  <span className="check-duration pr-muted">{seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}</span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
      {checks.length > 8 && passed.length > 0 && (
        <button className="side-more" onClick={() => setShowPassed((value) => !value)}>
          {showPassed ? 'Hide passed checks' : `Show ${passed.length} passed`}
        </button>
      )}
    </Card>
  );
}

/** A sidebar card while its stage loads: its title, and a line for each of a few rows. */
function SideCardSkeleton({ title, rows }: { title: string; rows: number }) {
  return (
    <Card className="side-card side-skeleton">
      <h3 className="side-card-title">{title}</h3>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="side-skeleton-row" aria-hidden="true">
          <Skeleton width={16} height={16} />
          <Skeleton width={`${70 - index * 15}%`} height={10} />
        </div>
      ))}
    </Card>
  );
}

export const MERGE_LABELS = {
  SQUASH: { short: 'Squash', verb: 'Squash and merge' },
  MERGE: { short: 'Merge commit', verb: 'Merge' },
  REBASE: { short: 'Rebase', verb: 'Rebase and merge' },
} as const;

/**
 * The stack merge CarbonLayer runs in the background (src/lib/stack-merges.ts): where it is, with Cancel, which stops it
 * where it is; once it stopped, why, with Dismiss.
 */
function BackgroundMergeCard({ merge, onDrop }: { merge: StackMerge; onDrop: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const { step } = merge;
  const shown = whereTheMergeIs(merge);
  return (
    <Card className={`side-card side-action is-${shown.tone}`}>
      <div className="side-action-title">
        <Icon name={shown.icon} size={16} />
        <span>{shown.title}</span>
      </div>
      <div className="side-action-detail">{shown.detail}</div>
      {merge.trouble && step.kind !== 'stopped' && (
        <div className="side-action-detail side-merge-trouble" title={merge.trouble}>
          {merge.trouble}
        </div>
      )}
      {step.kind !== 'merged' && (
        <Button
          className="side-action-button"
          disabled={busy}
          title={step.kind === 'stopped' ? undefined : 'Stop merging the stack. Nothing done on GitHub so far is undone.'}
          onClick={async () => {
            setBusy(true);
            if (!(await onDrop())) setBusy(false);
          }}
        >
          {step.kind === 'stopped' ? 'Dismiss' : 'Cancel'}
        </Button>
      )}
    </Card>
  );
}

/** Where a stack merge CarbonLayer runs in the background is, as its card says it. */
function whereTheMergeIs(merge: StackMerge): { tone: 'attention' | 'danger' | 'done'; icon: 'clock' | 'git-merge' | 'x-circle-fill'; title: string; detail: string } {
  const { step } = merge;
  const count = merge.prs.length;
  const verb = MERGE_LABELS[merge.method].verb;
  // What it does once nothing stands in the way, said where nothing more particular is.
  const plan = `${verb} ${count} PRs into ${merge.trunk} once the stack can merge.`;
  switch (step.kind) {
    case 'stopped':
      return { tone: 'danger', icon: 'x-circle-fill', title: 'Merge stopped', detail: step.reason };
    case 'merged':
      return { tone: 'done', icon: 'git-merge', title: `Merged ${count} PRs`, detail: `${verb} into ${merge.trunk}.` };
    case 'merging':
      return { tone: 'attention', icon: 'git-merge', title: 'Merging…', detail: `${verb} ${count} PRs into ${merge.trunk}.` };
    case 'rebasing':
      return { tone: 'attention', icon: 'clock', title: 'Rebasing stack…', detail: plan };
    case 'starting':
      return { tone: 'attention', icon: 'clock', title: 'Checking the stack…', detail: plan };
    case 'waiting': {
      const waiting = step.for;
      if (waiting?.kind === 'checks') {
        const { requiredPassed, required, optionalRunning } = waiting;
        return {
          tone: 'attention',
          icon: 'clock',
          title: required > 0 ? `Waiting for checks · ${requiredPassed} of ${required} required passed` : `Waiting for checks · ${optionalRunning} running`,
          detail: required > 0 && optionalRunning > 0 ? `And ${optionalRunning} optional ${optionalRunning === 1 ? 'check' : 'checks'} to finish. ${plan}` : plan,
        };
      }
      if (waiting?.kind === 'github') {
        return {
          tone: 'attention',
          icon: 'clock',
          title: `Waiting for GitHub · #${waiting.number}`,
          detail: `GitHub does not say #${waiting.number} can merge with the PRs below it yet${waiting.status ? ` (${waiting.status})` : ''}. ${plan}`,
        };
      }
      return { tone: 'attention', icon: 'clock', title: 'Checking the stack…', detail: plan };
    }
  }
}

/** CarbonLayer's own "Merge when ready" once it stopped: why, in GitHub's words where GitHub gave any, with Dismiss. */
function StoppedMergeWhenReady({ reason, onDismiss }: { reason: string; onDismiss: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="side-merge-when-ready-stopped" role="status">
      <span>CarbonLayer stopped merging this stack when ready: {reason}</span>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          if (!(await onDismiss())) setBusy(false);
        }}
      >
        Dismiss
      </Button>
    </div>
  );
}
