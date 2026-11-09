// Grouped by stack, a PR of a row's stack that its section does not list itself, drawn under the row as one condensed,
// muted line: its state, its place in the stack, its title and who opened it where, all of which the stack already says,
// so it asks for no details of its own. It keeps the rows' grid, so its left edge and the stack's rail line up with
// theirs, and is reached by j / k, the copy keys and a click as any row.
import { useEffect, useRef, type MouseEvent } from 'react';
import type { PrSummary, StackEntry } from '../lib/model';
import { Icon, type IconName } from '../ui/Icon';

/** A PR's state the way the PR page draws it (its state pill, the stack card's pill): its icon and its name on hover. */
const STATES: Record<'open' | 'draft' | 'merged' | 'closed', { icon: IconName; label: string }> = {
  open: { icon: 'git-pull-request', label: 'Open' },
  draft: { icon: 'git-pull-request-draft', label: 'Draft' },
  merged: { icon: 'git-merge', label: 'Merged' },
  closed: { icon: 'git-pull-request-closed', label: 'Closed' },
};

export function ContextRow({
  pr,
  place,
  selected,
  stacked,
  onIntent,
  onOpen,
}: {
  /** The stack's entry, whose author may be unknown, or the row another section lists for the PR. */
  pr: PrSummary | StackEntry;
  /** Where it sits in its stack's line, counted from the bottom. */
  place: { position: number; size: number };
  selected: boolean;
  /** Below the top of its stack: indented, hanging from the row above. */
  stacked: boolean;
  onIntent: (pr: PrSummary | StackEntry) => void;
  onOpen: (pr: PrSummary | StackEntry, newTab: boolean) => void;
}) {
  const row = useRef<HTMLDivElement | null>(null);
  // The pointer resting 150 ms on the row, not passing over it.
  const resting = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(resting.current), []);
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // A plain click anywhere on the row (title link included) opens the PR through the parent page; middle-click keeps
  // the title link's native behaviour because it never fires `click`.
  const open = (event: MouseEvent) => {
    event.preventDefault();
    onOpen(pr, event.metaKey || event.ctrlKey);
  };
  const state = pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'open';

  // `data-pr-id` tells the copy keys (InboxPage) which PR the row under the pointer is.
  return (
    <div
      ref={row}
      className={`gg-row gg-row--context${stacked ? ' gg-row--stacked' : ''}${selected ? ' is-selected' : ''}`}
      data-pr-id={pr.id}
      onClick={open}
      onMouseEnter={() => (resting.current = setTimeout(() => onIntent(pr), 150))}
      onMouseLeave={() => clearTimeout(resting.current)}
    >
      <span className="gg-row__unread" />
      <span className={`gg-row__state gg-row__state--${state}`} title={STATES[state].label}>
        <Icon name={STATES[state].icon} size={14} title={STATES[state].label} />
      </span>
      <div className="gg-row__main">
        <span className="gg-row__chip" title={`${place.position}/${place.size} position in stack`}>
          <Icon name="stack" size={12} />
          {place.position}/{place.size}
        </span>
        <a className="gg-row__title" href={pr.url} title={pr.title}>
          {pr.title}
        </a>
        <span className="gg-row__byline">
          {pr.author && `${pr.author.login} · `}
          {pr.repo.owner}/{pr.repo.name} #{pr.number}
        </span>
      </div>
    </div>
  );
}
