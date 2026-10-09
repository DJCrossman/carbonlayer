// The right sidebar: status (with Merge when ready), the one next step, checks, reviewers (Reviewers.tsx), labels and
// assignees. Cards with nothing to show are left out.
import { useState, type ReactNode } from 'react';
import type { MergeMethod } from '../lib/rpc';
import type { PrDetail } from '../lib/model';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { LabelChip } from '../ui/LabelChip';
import { RelativeTime } from '../ui/RelativeTime';
import { goToPr } from './navigation';
import { nextActionFor } from './next-action';
import { StatePill } from './primitives';
import './sidebar.css';

export function Sidebar({
  pr,
  mergeMethod,
  onAutoMerge,
  onMarkReady,
  onMerge,
  onViewThreads,
  reviewersCard,
}: {
  pr: PrDetail;
  /** The method the viewer prefers, already narrowed to what the repository allows. */
  mergeMethod: MergeMethod;
  onAutoMerge: (enabled: boolean) => Promise<boolean>;
  onMarkReady: () => Promise<boolean>;
  onMerge: (method: MergeMethod) => Promise<boolean>;
  onViewThreads: () => void;
  /** The Reviewers card (Reviewers.tsx), wired to the page's data source. */
  reviewersCard: ReactNode;
}) {
  return (
    <aside className="pr-sidebar" aria-label="Status">
      <StatusCard pr={pr} mergeMethod={mergeMethod} onAutoMerge={onAutoMerge} />
      <ActionCard pr={pr} mergeMethod={mergeMethod} onMarkReady={onMarkReady} onMerge={onMerge} onViewThreads={onViewThreads} />
      {pr.ci.checks.length > 0 && <ChecksCard pr={pr} />}
      {reviewersCard}
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
          <span className="pr-muted side-switch-method">{MERGE_LABELS[pr.autoMerge?.method ?? mergeMethod].short}</span>
        </label>
      )}
    </Card>
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

function ChecksCard({ pr }: { pr: PrDetail }) {
  const [showPassed, setShowPassed] = useState(false);
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

  return (
    <Card className="side-card">
      <h3 className="side-card-title">
        Checks{' '}
        <span className="pr-muted">
          · {passed.length}/{checks.length} passed
        </span>
      </h3>
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


const MERGE_LABELS = {
  SQUASH: { short: 'Squash', verb: 'Squash and merge' },
  MERGE: { short: 'Merge commit', verb: 'Merge' },
  REBASE: { short: 'Rebase', verb: 'Rebase and merge' },
} as const;
