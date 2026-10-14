// The right sidebar: status (with Merge when ready), the one next step, checks, reviewers (Reviewers.tsx), labels and
// assignees. Each card shows a skeleton until the stage it comes from arrives; cards with nothing to show are left out,
// except an open PR's checks, which says why it has none.
import { useEffect, useState, type ReactNode } from 'react';
import type { MergeMethod } from '../lib/rpc';
import type { PrDetail, PrStage } from '../lib/model';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { LabelChip } from '../ui/LabelChip';
import { RelativeTime } from '../ui/RelativeTime';
import { Skeleton } from '../ui/Skeleton';
import type { CheckReruns } from './check-reruns';
import { goToPr } from './navigation';
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
  onViewThreads,
  checkReruns,
  reviewersCard,
  finishReview,
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
  onViewThreads: () => void;
  checkReruns: CheckReruns;
  /** The Reviewers card (Reviewers.tsx), wired to the page's data source. */
  reviewersCard: ReactNode;
  /** Finish review again, under the reviewers, while the header's button is out of sight (PrPage's FinishReviewAgain). */
  finishReview: ReactNode;
}) {
  return (
    <aside className="pr-sidebar" aria-label="Status">
      <StatusCard pr={pr} mergeMethod={mergeMethod} onAutoMerge={onAutoMerge} onRevert={onRevert} />
      <ActionCard pr={pr} data={data} onRetry={onRetry} mergeMethod={mergeMethod} onMarkReady={onMarkReady} onMerge={onMerge} onViewThreads={onViewThreads} />
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
      {finishReview}
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
            {pr.labels.length > 0 && (
              <Card className="side-card">
                <h3 className="side-card-title">Labels</h3>
                <div className="side-labels">
                  {pr.labels.map((label) => (
                    <LabelChip key={label.name} label={label} />
                  ))}
                </div>
              </Card>
            )}
            {pr.assignees.length > 0 && (
              <Card className="side-card">
                <h3 className="side-card-title">Assignees</h3>
                <ul className="side-list">
                  {pr.assignees.map((user) => (
                    <li key={user.login} className="side-person">
                      <Avatar user={user} size={20} />
                      <span className="side-person-name">{user.login}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
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
}: {
  pr: PrDetail;
  mergeMethod: MergeMethod;
  onAutoMerge: (enabled: boolean, method: MergeMethod) => Promise<boolean>;
  onRevert: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  // Reverting creates a branch on GitHub, so it asks first.
  const [revert, setRevert] = useState<'idle' | 'confirming' | 'reverting'>('idle');
  // The method Merge when ready merges with: auto-merge's own while it is on, else the one picked here.
  const [picked, setPicked] = useState<MergeMethod>(mergeMethod);
  const method = pr.autoMerge?.method ?? picked;
  const methods = pr.allowedMergeMethods.length > 0 ? pr.allowedMergeMethods : (['SQUASH', 'MERGE', 'REBASE'] as const);
  // Who merged or closed it comes from the last such event in the timeline.
  const ending = pr.state === 'OPEN' ? undefined : pr.timeline.findLast((item) => item.kind === (pr.state === 'MERGED' ? 'merged' : 'closed'));
  const endedBy = ending && 'actor' in ending ? ending.actor : null;
  const endedAt = pr.mergedAt ?? (ending && 'createdAt' in ending ? ending.createdAt : null);
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
      {pr.state === 'OPEN' && (pr.viewerCanEnableAutoMerge || pr.autoMerge !== null) && (
        <div className="side-switch-row">
          <label className="side-switch">
            <input
              type="checkbox"
              role="switch"
              checked={pr.autoMerge !== null}
              disabled={busy}
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
              const chosen = event.target.value as MergeMethod;
              setPicked(chosen);
              // While it is on, a new method applies at once.
              if (pr.autoMerge === null) return;
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
  onViewThreads,
}: {
  pr: PrDetail;
  data: PrPageData;
  onRetry: (stages: PrStage[]) => void;
  mergeMethod: MergeMethod;
  onMarkReady: () => Promise<boolean>;
  onMerge: (method: MergeMethod) => Promise<boolean>;
  onViewThreads: () => void;
}) {
  // The stages the next step depends on that have not arrived, loading or failed.
  const unknown = (['mergeBox', 'stack', 'threads', 'checks'] as const).filter((stage) => data[stage].value === null);
  const action = nextActionFor(pr, unknown);
  const [busy, setBusy] = useState(false);
  if (action.kind === 'checking') {
    const failed = unknown.flatMap((stage) => {
      const state = data[stage];
      return state.status === 'error' ? [{ stage, error: state.error }] : [];
    });
    return (
      <Card className={`side-card side-action ${failed.length > 0 ? 'is-danger' : 'is-neutral is-checking'}`}>
        {failed.length > 0 ? (
          <div className="side-action-title" role="alert">
            <Icon name="alert" size={16} />
            <span className="side-action-failed" title={failed[0]!.error}>
              Could not check mergeability <span className="pr-muted">· {failed[0]!.error}</span>
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
      {action.kind === 'unresolved' && (
        <Button className="side-action-button" onClick={onViewThreads} title="Next unresolved thread (n)">
          View comments
        </Button>
      )}
      {action.kind === 'checks-failed' && failingCheck?.url && (
        <a className="gg-btn gg-btn--default gg-btn--md side-action-button" href={failingCheck.url} target="_blank" rel="noopener">
          View check
        </a>
      )}
      {action.kind === 'ready' && <MergeControls pr={pr} mergeMethod={mergeMethod} onMerge={onMerge} />}
    </Card>
  );
}

function MergeControls({ pr, mergeMethod, onMerge }: { pr: PrDetail; mergeMethod: MergeMethod; onMerge: (method: MergeMethod) => Promise<boolean> }) {
  const [method, setMethod] = useState<MergeMethod>(mergeMethod);
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
      <select className="pr-select" value={method} onChange={(event) => setMethod(event.target.value as MergeMethod)} aria-label="Merge method">
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
        onClick={() => setConfirming(true)}
      >
        <Icon name="git-merge" size={14} />
        Merge
      </Button>
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
              <a className="check-row" href={check.url ?? undefined} target="_blank" rel="noopener" title={check.description ?? undefined}>
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

const MERGE_LABELS = {
  SQUASH: { short: 'Squash', verb: 'Squash and merge' },
  MERGE: { short: 'Merge commit', verb: 'Merge' },
  REBASE: { short: 'Rebase', verb: 'Rebase and merge' },
} as const;
