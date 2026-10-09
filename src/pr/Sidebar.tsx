// The right sidebar: status (with Merge when ready), the one next step, checks, reviewers, labels and
// assignees. Cards with nothing to show are left out.
import { useState, type ReactNode } from 'react';
import type { MergeMethod } from '../lib/rpc';
import type { PrDetail } from '../lib/model';
import { goToPr } from './navigation';
import { nextActionFor } from './next-action';
import { Avatar, CheckIcon, Icon, LabelChip, RelativeTime, ReviewStateIcon, StatePill } from './primitives';
import './sidebar.css';

export function Sidebar({
  pr,
  mergeMethod,
  onAutoMerge,
  onMarkReady,
  onMerge,
  onViewThreads,
}: {
  pr: PrDetail;
  /** The method the viewer prefers, already narrowed to what the repository allows. */
  mergeMethod: MergeMethod;
  onAutoMerge: (enabled: boolean) => Promise<boolean>;
  onMarkReady: () => Promise<boolean>;
  onMerge: (method: MergeMethod) => Promise<boolean>;
  onViewThreads: () => void;
}) {
  return (
    <aside className="pr-sidebar" aria-label="Status">
      <StatusCard pr={pr} mergeMethod={mergeMethod} onAutoMerge={onAutoMerge} />
      <ActionCard pr={pr} mergeMethod={mergeMethod} onMarkReady={onMarkReady} onMerge={onMerge} onViewThreads={onViewThreads} />
      {pr.ci.checks.length > 0 && <ChecksCard pr={pr} />}
      {pr.reviewers.length > 0 && (
        <SideCard title="Reviewers">
          <ul className="side-list">
            {pr.reviewers.map((reviewer) => (
              <li key={reviewer.user.login} className="side-person">
                {reviewer.kind === 'team' ? (
                  <span className="side-team-icon">
                    <Icon name="people" size={12} />
                  </span>
                ) : (
                  <Avatar user={reviewer.user} size={20} />
                )}
                <span className="side-person-name">{reviewer.user.login}</span>
                <span title={REVIEWER_STATE_LABELS[reviewer.state]}>
                  <ReviewStateIcon state={reviewer.state} />
                </span>
              </li>
            ))}
          </ul>
        </SideCard>
      )}
      {pr.labels.length > 0 && (
        <SideCard title="Labels">
          <div className="side-labels">
            {pr.labels.map((label) => (
              <LabelChip key={label.name} label={label} />
            ))}
          </div>
        </SideCard>
      )}
      {pr.assignees.length > 0 && (
        <SideCard title="Assignees">
          <ul className="side-list">
            {pr.assignees.map((user) => (
              <li key={user.login} className="side-person">
                <Avatar user={user} size={20} />
                <span className="side-person-name">{user.login}</span>
              </li>
            ))}
          </ul>
        </SideCard>
      )}
    </aside>
  );
}

function StatusCard({ pr, mergeMethod, onAutoMerge }: { pr: PrDetail; mergeMethod: MergeMethod; onAutoMerge: (enabled: boolean) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  // Who merged or closed it comes from the last such event in the timeline.
  const ending = pr.state === 'OPEN' ? undefined : pr.timeline.findLast((item) => item.kind === (pr.state === 'MERGED' ? 'merged' : 'closed'));
  const endedBy = ending && 'actor' in ending ? ending.actor : null;
  const endedAt = pr.mergedAt ?? (ending && 'createdAt' in ending ? ending.createdAt : null);
  return (
    <div className="gg-card side-card side-status">
      <div className="side-status-line">
        <StatePill pr={pr} />
        {pr.state === 'OPEN' ? (
          <span className="gg-muted side-status-into">
            into <span className="gg-mono">{pr.baseRefName}</span>
          </span>
        ) : (
          <span className="gg-muted">
            {endedBy && `by ${endedBy.login} `}
            {endedAt && <RelativeTime iso={endedAt} />}
          </span>
        )}
      </div>
      {pr.state === 'OPEN' && pr.viewerCanEnableAutoMerge && (
        <label className="side-switch">
          <input
            type="checkbox"
            role="switch"
            checked={pr.autoMerge !== null}
            disabled={busy}
            onChange={async (event) => {
              setBusy(true);
              await onAutoMerge(event.target.checked);
              setBusy(false);
            }}
          />
          <span className="side-switch-track" aria-hidden="true" />
          <span>Merge when ready</span>
          <span className="gg-muted side-switch-method">{MERGE_LABELS[pr.autoMerge?.method ?? mergeMethod].short}</span>
        </label>
      )}
    </div>
  );
}

function ActionCard({
  pr,
  mergeMethod,
  onMarkReady,
  onMerge,
  onViewThreads,
}: {
  pr: PrDetail;
  mergeMethod: MergeMethod;
  onMarkReady: () => Promise<boolean>;
  onMerge: (method: MergeMethod) => Promise<boolean>;
  onViewThreads: () => void;
}) {
  const action = nextActionFor(pr);
  const [busy, setBusy] = useState(false);
  const failingCheck = pr.ci.checks.find((check) => check.state === 'FAILURE');
  const icon = ({ success: 'check-circle', danger: 'x-circle', attention: 'clock', neutral: 'pr-draft', done: 'merge' } as const)[action.tone];
  return (
    <div className={`gg-card side-card side-action is-${action.tone}`}>
      <div className="side-action-title">
        <Icon name={icon} size={16} />
        <span>{action.title}</span>
      </div>
      {action.detail && <div className="side-action-detail">{action.detail}</div>}
      {action.kind === 'draft' && pr.viewerCanUpdate && (
        <button
          className="gg-btn side-action-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onMarkReady();
            setBusy(false);
          }}
        >
          Ready for review
        </button>
      )}
      {action.kind === 'downstack' && (
        <button className="gg-btn side-action-button" onClick={() => goToPr(action.pr)}>
          Go to #{action.pr.number}
        </button>
      )}
      {action.kind === 'unresolved' && (
        <button className="gg-btn side-action-button" onClick={onViewThreads} title="Next unresolved thread (n)">
          View comments
        </button>
      )}
      {action.kind === 'checks-failed' && failingCheck?.url && (
        <a className="gg-btn side-action-button" href={failingCheck.url} target="_blank" rel="noopener">
          View check
        </a>
      )}
      {action.kind === 'ready' && <MergeControls pr={pr} mergeMethod={mergeMethod} onMerge={onMerge} />}
    </div>
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
          {MERGE_LABELS[method].verb} <strong>#{pr.number}</strong> into <span className="gg-mono">{pr.baseRefName}</span>?
        </div>
        <div className="merge-row">
          <button className="gg-btn" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </button>
          <button
            className="gg-btn is-merge"
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
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="merge-row">
      <select className="gg-select" value={method} onChange={(event) => setMethod(event.target.value as MergeMethod)} aria-label="Merge method">
        {pr.allowedMergeMethods.map((allowed) => (
          <option key={allowed} value={allowed}>
            {MERGE_LABELS[allowed].short}
          </option>
        ))}
      </select>
      <button
        className="gg-btn is-merge merge-button"
        disabled={!pr.viewerCanMerge}
        title={pr.viewerCanMerge ? undefined : 'You do not have permission to merge this pull request'}
        onClick={() => setConfirming(true)}
      >
        <Icon name="merge" size={14} />
        Merge
      </button>
    </div>
  );
}

function ChecksCard({ pr }: { pr: PrDetail }) {
  const [showPassed, setShowPassed] = useState(false);
  const { checks } = pr.ci;
  const passed = checks.filter((check) => check.state === 'SUCCESS');
  // Failing first, then running, then everything else.
  const rank = (state: string) => (state === 'FAILURE' || state === 'CANCELLED' ? 0 : state === 'PENDING' ? 1 : 2);
  const sorted = [...checks].sort((a, b) => rank(a.state) - rank(b.state));
  const hidePassed = checks.length > 8 && !showPassed;
  const visible = hidePassed ? sorted.filter((check) => check.state !== 'SUCCESS') : sorted;
  const segments = [
    ['success', passed.length],
    ['danger', checks.filter((check) => rank(check.state) === 0).length],
    ['attention', checks.filter((check) => check.state === 'PENDING').length],
  ] as const;
  const other = checks.length - segments.reduce((sum, [, count]) => sum + count, 0);

  return (
    <SideCard
      title={
        <>
          Checks{' '}
          <span className="gg-muted">
            · {passed.length}/{checks.length} passed
          </span>
        </>
      }
    >
      <div className="checks-bar" aria-hidden="true">
        {[...segments, ['neutral', other] as const].map(([tone, count]) =>
          count > 0 ? <span key={tone} className={`is-${tone}`} style={{ flexGrow: count }} /> : null,
        )}
      </div>
      <ul className="side-list checks-list">
        {visible.map((check) => {
          const seconds =
            check.startedAt && check.completedAt ? Math.round((Date.parse(check.completedAt) - Date.parse(check.startedAt)) / 1000) : null;
          return (
            <li key={`${check.group ?? ''}/${check.name}`}>
              <a className="check-row" href={check.url ?? undefined} target="_blank" rel="noopener" title={check.description ?? undefined}>
                <CheckIcon state={check.state} />
                <span className="check-name">{check.name}</span>
                {check.group && <span className="check-group gg-muted">{check.group}</span>}
                {pr.requiredCheckNames.includes(check.name) && <span className="check-required">Required</span>}
                {seconds !== null && (
                  <span className="check-duration gg-muted">{seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}</span>
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
    </SideCard>
  );
}

function SideCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="gg-card side-card">
      <h3 className="side-card-title">{title}</h3>
      {children}
    </section>
  );
}

const REVIEWER_STATE_LABELS = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Requested changes',
  COMMENTED: 'Commented',
  PENDING: 'Review requested',
  DISMISSED: 'Review dismissed',
} as const;

const MERGE_LABELS = {
  SQUASH: { short: 'Squash', verb: 'Squash and merge' },
  MERGE: { short: 'Merge commit', verb: 'Merge' },
  REBASE: { short: 'Rebase', verb: 'Rebase and merge' },
} as const;
