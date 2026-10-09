// One inbox view as a collapsible card: header "Name N" with a gear that opens the section editor, then one dense row
// per PR (skeleton rows while loading).
import { useEffect, useRef, type MouseEvent } from 'react';
import type { PrSummary, View, ViewResult } from '../lib/model';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CiStatus } from '../ui/CiStatus';
import { Icon } from '../ui/Icon';
import { LabelChip } from '../ui/LabelChip';
import { MergeStatus } from '../ui/MergeStatus';
import { RelativeTime } from '../ui/RelativeTime';
import { ReviewStatus } from '../ui/ReviewStatus';
import { Skeleton } from '../ui/Skeleton';
import { StatusPill } from '../ui/StatusPill';

export function InboxSection({
  view,
  result,
  loading,
  selectedPrId,
  overdueAfterHours,
  onToggleCollapsed,
  onEdit,
  onOpen,
}: {
  view: View;
  result: ViewResult | undefined;
  loading: boolean;
  selectedPrId: string | null;
  overdueAfterHours: number | undefined;
  onToggleCollapsed: () => void;
  onEdit: () => void;
  onOpen: (pr: PrSummary, newTab: boolean) => void;
}) {
  const expanded = view.collapsed !== true;
  const empty = result?.prs.length === 0;
  return (
    <Card
      className="gg-section"
      header={
        <>
          <button type="button" className="gg-section__toggle" aria-expanded={expanded} onClick={onToggleCollapsed}>
            <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} className="gg-section__chevron" />
            <span className="gg-section__name">{view.name}</span>
            {empty ? (
              <span className="gg-section__empty">No pull requests</span>
            ) : (
              result && (
                <span className="gg-section__count">
                  {view.limit !== undefined && result.totalCount > view.limit ? `${view.limit}+` : result.totalCount}
                </span>
              )
            )}
          </button>
          <Button variant="ghost" size="sm" icon="gear" className="gg-section__edit" aria-label={`Edit ${view.name}`} title="Edit section" onClick={onEdit} />
        </>
      }
    >
      {expanded &&
        !empty &&
        (result
          ? result.prs.map((pr) => (
              <PrRow key={pr.id} pr={pr} selected={pr.id === selectedPrId} overdueAfterHours={overdueAfterHours} onOpen={onOpen} />
            ))
          : loading && ['48%', '62%', '36%'].map((width) => <SkeletonRow key={width} titleWidth={width} />))}
    </Card>
  );
}

function PrRow({
  pr,
  selected,
  overdueAfterHours,
  onOpen,
}: {
  pr: PrSummary;
  selected: boolean;
  overdueAfterHours: number | undefined;
  onOpen: (pr: PrSummary, newTab: boolean) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // A plain click anywhere on the row (title link included) opens the PR through the parent page; middle-click keeps
  // the title link's native behaviour because it never fires `click`.
  const open = (event: MouseEvent) => {
    event.preventDefault();
    onOpen(pr, event.metaKey || event.ctrlKey);
  };

  return (
    <div ref={row} className={selected ? 'gg-row is-selected' : 'gg-row'} onClick={open}>
      <span className="gg-row__unread">{pr.unread && <span className="gg-row__dot" title="Unread" />}</span>
      <ReviewStatus state={pr.reviewDecision} />
      <Avatar user={pr.author} size={20} />
      <div className="gg-row__main">
        <a className="gg-row__title" href={pr.url} title={pr.title}>
          {pr.title}
        </a>
        <div className="gg-row__meta">
          <span className="gg-row__byline">
            {pr.author.login} • {pr.repo.owner}/{pr.repo.name} #{pr.number}
          </span>
          {pr.labels.slice(0, 4).map((label) => (
            <LabelChip key={label.name} label={label} />
          ))}
          {pr.labels.length > 4 && (
            <span className="gg-row__more" title={pr.labels.slice(4).map((label) => label.name).join(', ')}>
              +{pr.labels.length - 4}
            </span>
          )}
        </div>
      </div>
      <span className="gg-row__stack">
        {pr.nativeStack && (
          <span className="gg-row__stack-chip" title={`Stacked: ${pr.nativeStack.position} of ${pr.nativeStack.size}`}>
            <Icon name="stack" size={12} />
            {pr.nativeStack.position}/{pr.nativeStack.size}
          </span>
        )}
      </span>
      <span className="gg-row__ci">
        <CiStatus ci={pr.ci} />
      </span>
      <span className="gg-row__merge">
        {pr.state === 'OPEN' && pr.isInMergeQueue ? (
          <StatusPill tone="accent" icon="git-merge" title="Queued in the merge queue">
            Merging
          </StatusPill>
        ) : pr.state === 'OPEN' && pr.autoMerge ? (
          <StatusPill tone="accent" icon="clock" title={`Auto-merge (${pr.autoMerge.method.toLowerCase()}) once requirements are met`}>
            Auto-merge
          </StatusPill>
        ) : (
          <MergeStatus status={pr.mergeStatus} state={pr.state} />
        )}
      </span>
      {/* GitHub's dashboard endpoints report no line counts; zeros mean unknown, not an empty diff. */}
      <span className="gg-row__diff" title={pr.changedFiles > 0 ? `${pr.changedFiles} files changed` : undefined}>
        {(pr.additions > 0 || pr.deletions > 0) && (
          <>
            <span className="gg-row__add">+{pr.additions}</span>
            <span className="gg-row__del">−{pr.deletions}</span>
          </>
        )}
      </span>
      <span className="gg-row__comments" title={`${pr.commentCount} comments`}>
        {pr.commentCount > 0 && (
          <>
            <Icon name="comment" size={12} />
            {pr.commentCount}
          </>
        )}
      </span>
      <span className="gg-row__age">
        <RelativeTime date={pr.updatedAt} overdueAfterHours={pr.state === 'OPEN' ? overdueAfterHours : undefined} />
      </span>
    </div>
  );
}

function SkeletonRow({ titleWidth }: { titleWidth: string }) {
  return (
    <div className="gg-row gg-row--skeleton" aria-hidden>
      <span />
      <Skeleton width={14} height={14} />
      <Skeleton width={20} height={20} />
      <div className="gg-row__main">
        <Skeleton width={titleWidth} height={10} />
        <Skeleton width="22%" height={8} />
      </div>
      <span />
      <Skeleton width="100%" height={6} />
      <Skeleton width={72} height={18} />
    </div>
  );
}
