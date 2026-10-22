// One inbox view as a collapsible card, laid out like Graphite's inbox: header "Name N" with a gear that opens the section
// editor, a column header row (sortable Title, Changes and Updated; icons over the Review, CI and Merge columns), then one
// dense row per PR in fixed columns so the status icons line up (skeleton rows while loading). Every icon in a row says
// what it means on hover.
import { useEffect, useEffectEvent, useRef, type MouseEvent } from 'react';
import type { PrEnrichment, PrSummary, ReviewerSummary, View, ViewResult } from '../lib/model';
import { sectionCount } from '../lib/views';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { RelativeTime } from '../ui/RelativeTime';
import { Skeleton } from '../ui/Skeleton';
import { StatusIcon } from '../ui/StatusIcon';
import { ciStatusIcon, mergeStatusIcon, reviewStatusIcon } from '../ui/status-icons';
import type { StackPlace } from './stacks';

export function InboxSection({
  view,
  result,
  loading,
  sort,
  selectedPrId,
  overdueAfterHours,
  viewerLogin,
  enrichmentOf,
  stackedPrIds,
  stackPlaces,
  awaitingStacks,
  more,
  onSort,
  onRowShown,
  onRowIntent,
  onLoadMore,
  onToggleCollapsed,
  onEdit,
  onOpen,
}: {
  view: View;
  /** The section's rows, already in `sort` order. */
  result: ViewResult | undefined;
  loading: boolean;
  sort: SectionSort;
  selectedPrId: string | null;
  overdueAfterHours: number | undefined;
  /** The signed-in user, "you" in the Review column; null while unknown. */
  viewerLogin: string | null;
  /**
   * What GitHub's dashboard left out of a row and its page data said (merge status, reviewers, line counts, failing
   * checks); undefined until it arrives, when the reviewer and Changes columns show a skeleton dash.
   */
  enrichmentOf: (pr: PrSummary) => PrEnrichment | undefined;
  /** Grouped by stack, the ids of the rows below the top of their stack, which hang under the row above. */
  stackedPrIds?: ReadonlySet<string>;
  /** Where each row the inbox knows sits in its stack, by PR id (`stackPlaces`), for the chip of a stack GitHub doesn't track. */
  stackPlaces: ReadonlyMap<string, StackPlace>;
  /** Grouped by stack, the rows wait for their stacks to be known: skeleton rows show in their place. */
  awaitingStacks?: boolean;
  /** Whether GitHub has rows beyond those shown ("Load more"), and whether they are on their way. */
  more: 'more' | 'loading' | 'none';
  onSort: (by: SectionSort['by']) => void;
  onLoadMore: () => void;
  /** A row came within 200px of view (again, after it was updated): time to ask for what the dashboard leaves out. */
  onRowShown: (pr: PrSummary) => void;
  /** The pointer rested on a row: the viewer may open it next. */
  onRowIntent: (pr: PrSummary) => void;
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
            {result?.error ? (
              <span className="gg-section__failed">Could not load</span>
            ) : empty ? (
              <span className="gg-section__empty">No pull requests</span>
            ) : (
              result && <span className="gg-section__count">{sectionCount(result)}</span>
            )}
          </button>
          <Button variant="ghost" size="sm" icon="gear" className="gg-section__edit" aria-label={`Edit ${view.name}`} title="Edit section" onClick={onEdit} />
        </>
      }
    >
      {/* GitHub's reason in place of the rows, and what it was asked, so the part it rejected can be found. */}
      {expanded && result?.error && (
        <div className="gg-section__error">
          <Icon name="alert" size={14} />
          <div className="gg-section__error-text">
            {/* GitHub's status page, where an outage behind the error would be posted. */}
            <span>
              {result.error.message}{' '}
              <a className="gg-section__status-link" href="https://www.githubstatus.com/" target="_blank" rel="noopener">
                GitHub status
                <Icon name="link-external" size={12} />
              </a>
            </span>
            <code className="gg-section__query" title="What GitHub was asked">
              {result.error.query}
            </code>
          </div>
        </div>
      )}
      {expanded && !empty && (result || loading) && (
        <div className="gg-section__columns">
          <span />
          <span />
          <SortHeader by="title" label="Title" sort={sort} onSort={onSort} />
          <span className="gg-row__reviewers" />
          <span className="gg-row__labels" />
          <span className="gg-row__conversations" />
          <span className="gg-row__stack" />
          <span className="gg-row__status" title="Review status">
            <Icon name="person-check" size={14} />
          </span>
          <span className="gg-row__status" title="CI status">
            <Icon name="play" size={14} />
          </span>
          <span className="gg-row__status" title="Merge status">
            <Icon name="git-merge" size={14} />
          </span>
          <SortHeader by="changes" label="Changes" sort={sort} onSort={onSort} className="gg-row__diff" />
          <SortHeader by="updated" label="Updated" sort={sort} onSort={onSort} className="gg-row__age" />
        </div>
      )}
      {expanded &&
        !empty &&
        (result && !awaitingStacks
          ? result.prs.map((pr) => (
              <PrRow
                key={pr.id}
                pr={pr}
                enrichment={enrichmentOf(pr)}
                viewerLogin={viewerLogin}
                selected={pr.id === selectedPrId}
                stacked={stackedPrIds?.has(pr.id) === true}
                stackPlace={stackPlaces.get(pr.id)}
                overdueAfterHours={overdueAfterHours}
                onShown={onRowShown}
                onIntent={onRowIntent}
                onOpen={onOpen}
              />
            ))
          : (awaitingStacks || loading) && ['48%', '62%', '36%'].map((width) => <SkeletonRow key={width} titleWidth={width} />))}
      {expanded && result && !awaitingStacks && more !== 'none' && (
        <button type="button" className="gg-section__more" disabled={more === 'loading'} onClick={onLoadMore}>
          {more === 'loading' ? 'Loading…' : 'Load more'}
        </button>
      )}
    </Card>
  );
}

/** How a section orders its rows, as its column headers were last clicked; Graphite's default is latest updated first. */
export interface SectionSort {
  by: 'title' | 'changes' | 'updated';
  descending: boolean;
}

function SortHeader({
  by,
  label,
  sort,
  onSort,
  className,
}: {
  by: SectionSort['by'];
  label: string;
  sort: SectionSort;
  onSort: (by: SectionSort['by']) => void;
  className?: string;
}) {
  const active = sort.by === by;
  return (
    <button
      type="button"
      className={`gg-section__sort${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      aria-pressed={active}
      title={`Sort by ${label.toLowerCase()}`}
      onClick={() => onSort(by)}
    >
      {label}
      {active && <Icon name={sort.descending ? 'arrow-down' : 'arrow-up'} size={12} />}
    </button>
  );
}

function PrRow({
  pr,
  enrichment,
  viewerLogin,
  selected,
  stacked,
  stackPlace,
  overdueAfterHours,
  onShown,
  onIntent,
  onOpen,
}: {
  /** The row with its enrichment applied. */
  pr: PrSummary;
  enrichment: PrEnrichment | undefined;
  viewerLogin: string | null;
  selected: boolean;
  /** Below the top of its stack: indented, hanging from the row above. */
  stacked: boolean;
  /** Where it sits in its stack among the rows the inbox knows; undefined while it stands alone. */
  stackPlace: StackPlace | undefined;
  overdueAfterHours: number | undefined;
  onShown: (pr: PrSummary) => void;
  onIntent: (pr: PrSummary) => void;
  onOpen: (pr: PrSummary, newTab: boolean) => void;
}) {
  const row = useRef<HTMLDivElement | null>(null);
  // The pointer resting 150 ms on the row, not passing over it.
  const resting = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(resting.current), []);
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const shown = useEffectEvent(() => onShown(pr));
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    // `root: document` is this page's own scrolling viewport (in the extension, the iframe's), where the margin applies;
    // with no root it would be github.com's, which ignores a margin for a frame of another origin.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        shown();
      },
      { root: document, rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [pr.id, pr.updatedAt, pr.ci.state]);

  // A plain click anywhere on the row (title link included) opens the PR through the parent page; middle-click keeps
  // the title link's native behaviour because it never fires `click`.
  const open = (event: MouseEvent) => {
    event.preventDefault();
    onOpen(pr, event.metaKey || event.ctrlKey);
  };
  const enriched = enrichment !== undefined;
  const shownReviewers = pr.reviewers.slice(0, 3);
  const moreReviewers = pr.reviewers.slice(3);
  // One line a reviewer: "jlord · approved".
  const reviewersTitle = pr.reviewers.map((reviewer) => `${reviewer.user.login} · ${REVIEWER_STATE_WORDS[reviewer.state]}`).join('\n');

  // `data-pr-id` tells the copy keys (InboxPage) which PR the row under the pointer is.
  return (
    <div
      ref={row}
      className={`gg-row${stacked ? ' gg-row--stacked' : ''}${selected ? ' is-selected' : ''}`}
      data-pr-id={pr.id}
      onClick={open}
      onMouseEnter={() => (resting.current = setTimeout(() => onIntent(pr), 150))}
      onMouseLeave={() => clearTimeout(resting.current)}
    >
      <span className="gg-row__unread">{pr.unread && <span className="gg-row__dot" title="Unread" />}</span>
      <Avatar user={pr.author} size={20} />
      <div className="gg-row__main">
        <a className="gg-row__title" href={pr.url} title={pr.title}>
          {pr.title}
        </a>
        <span className="gg-row__byline">
          {pr.author.login} · {pr.repo.owner}/{pr.repo.name} #{pr.number}
        </span>
      </div>
      <span className="gg-row__reviewers" title={reviewersTitle || undefined}>
        {!enriched && <Skeleton width={12} height={3} />}
        {shownReviewers.map((reviewer) => (
          <Avatar key={reviewer.user.login} user={reviewer.user} size={16} title={reviewersTitle} />
        ))}
        {moreReviewers.length > 0 && <span className="gg-row__more">+{moreReviewers.length}</span>}
      </span>
      <span className="gg-row__labels">
        {pr.labels.length > 0 && (
          <span className="gg-row__chip" title={pr.labels.map((label) => label.name).join(', ')}>
            {pr.labels.length} {pr.labels.length === 1 ? 'label' : 'labels'}
          </span>
        )}
      </span>
      {/* Graphite's conversation counter, resolved of all; it comes with the row's details, and a PR with none shows nothing. */}
      <span className="gg-row__conversations">
        {pr.conversations && pr.conversations.total > 0 && (
          <span
            className="gg-row__chip"
            title={`${pr.conversations.resolved} of ${pr.conversations.total} ${pr.conversations.total === 1 ? 'conversation' : 'conversations'} resolved`}
          >
            <Icon name="comment-discussion" size={12} />
            {pr.conversations.resolved}/{pr.conversations.total}
          </span>
        )}
      </span>
      <span className="gg-row__stack">
        {pr.nativeStack && (
          <span className="gg-row__chip" title={`Stacked: ${pr.nativeStack.position} of ${pr.nativeStack.size}`}>
            <Icon name="stack" size={12} />
            {pr.nativeStack.position}/{pr.nativeStack.size}
          </span>
        )}
        {/* A stack GitHub doesn't track is known only from branch names, counted among the PRs the inbox has. */}
        {stackPlace?.untracked && (
          <span
            className="gg-row__chip gg-row__chip--attention"
            title={`${stackPlace.position} of ${stackPlace.size} in a stack GitHub doesn't track (worked out from branch names)`}
          >
            <Icon name="stack" size={12} />
            {stackPlace.position}/{stackPlace.size}
          </span>
        )}
      </span>
      <span className="gg-row__status">
        {/* Who reviewed comes with the row's details; a draft's pencil does not wait for them. */}
        {!enriched && !pr.isDraft ? (
          <Skeleton width={16} height={16} />
        ) : (
          <StatusIcon {...reviewStatusIcon({ ...pr, reviewers: enrichment?.reviewers ?? null, viewerReview: enrichment?.viewerReview }, viewerLogin)} />
        )}
      </span>
      <span className="gg-row__status">
        {/* The dashboard's rollup says only that checks fail, run or pass; whether a required one fails, anything but
            Graphite's mergeability check still runs, or one of GitHub's own dynamic workflow runs failed comes with the
            row's checks, so an open row keeps a placeholder until then. A merged or closed row shows its rollup. */}
        {!enriched && pr.state === 'OPEN' ? <Skeleton width={16} height={16} /> : <StatusIcon {...ciStatusIcon(pr.ci, enrichment?.requiredCheckNames ?? null)} />}
      </span>
      <span className="gg-row__status">
        {/* An open row's mergeability comes with its merge box; a merged or closed row says so at once. */}
        {!enriched && pr.state === 'OPEN' ? <Skeleton width={16} height={16} /> : <StatusIcon {...mergeStatusIcon(pr, enrichment?.mergeBlockedReason)} />}
      </span>
      {/* GitHub's dashboard reports no line counts; they come with the row's enrichment (its diffstat), else stay hidden. */}
      <span className="gg-row__diff" title={pr.changedFiles > 0 ? `${pr.changedFiles} files changed` : undefined}>
        {!enriched ? (
          <Skeleton width={12} height={3} />
        ) : (
          (pr.additions > 0 || pr.deletions > 0) && (
            <>
              <span className="gg-row__add">+{pr.additions}</span>
              <span className="gg-row__del">−{pr.deletions}</span>
            </>
          )
        )}
      </span>
      <span className="gg-row__age">
        <RelativeTime date={pr.updatedAt} overdueAfterHours={pr.state === 'OPEN' ? overdueAfterHours : undefined} />
      </span>
    </div>
  );
}

/** How a reviewer's state reads in the reviewers' tooltip. */
const REVIEWER_STATE_WORDS: Record<ReviewerSummary['state'], string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes requested',
  COMMENTED: 'commented',
  PENDING: 'requested',
  DISMISSED: 'dismissed',
};

function SkeletonRow({ titleWidth }: { titleWidth: string }) {
  return (
    <div className="gg-row gg-row--skeleton" aria-hidden>
      <span />
      <Skeleton width={20} height={20} />
      <div className="gg-row__main">
        <Skeleton width={titleWidth} height={10} />
        <Skeleton width="22%" height={8} />
      </div>
      <span className="gg-row__reviewers" />
      <span className="gg-row__labels" />
      <span className="gg-row__conversations" />
      <span className="gg-row__stack" />
      <span className="gg-row__status">
        <Skeleton width={12} height={3} />
      </span>
      <span className="gg-row__status">
        <Skeleton width={12} height={3} />
      </span>
      <span className="gg-row__status">
        <Skeleton width={12} height={3} />
      </span>
      <span className="gg-row__diff">
        <Skeleton width={56} height={8} />
      </span>
      <span className="gg-row__age">
        <Skeleton width={24} height={8} />
      </span>
    </div>
  );
}
