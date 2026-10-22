// The sidebar's Assignees card: who is assigned, and GitHub's assignees menu for changing that. The gear opens a picker of
// the people GitHub offers whose ticks are sent as one change when it closes; with no one assigned, "assign yourself" does
// it in one click. Every change is followed by a refetch, which shows the outcome.
import { useEffect, useRef, useState } from 'react';
import type { AssigneeCandidate, PrDetail, UserRef } from '../lib/model';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import './reviewers.css';

export function AssigneesCard({
  pr,
  viewerLogin,
  listAssignees,
  onModify,
}: {
  pr: PrDetail;
  viewerLogin: string;
  listAssignees: () => Promise<AssigneeCandidate[]>;
  /** Assigns and unassigns people, by login. */
  onModify: (add: string[], remove: string[]) => Promise<boolean>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Picker rows whose tick the viewer flipped, by login; sent when the picker closes. */
  const [flipped, setFlipped] = useState<ReadonlyMap<string, AssigneeCandidate>>(new Map());
  // GitHub lets whoever can edit the PR change its assignees.
  const canEdit = pr.viewerCanUpdate;
  if (pr.assignees.length === 0 && !canEdit) return null;

  async function save(work: () => Promise<boolean>) {
    setBusy(true);
    await work();
    setBusy(false);
  }

  function closePicker() {
    setPickerOpen(false);
    setFlipped(new Map());
    const changed = [...flipped.values()];
    const add = changed.filter((user) => !isAssigned(pr.assignees, user)).map((user) => user.login);
    const remove = changed.filter((user) => isAssigned(pr.assignees, user)).map((user) => user.login);
    if (add.length > 0 || remove.length > 0) void save(() => onModify(add, remove));
  }

  return (
    <Card className="side-card">
      <div className="side-card-head">
        <h3 className="side-card-title">
          Assignees {busy && <span className="pr-muted">· saving…</span>}
        </h3>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            icon="gear"
            className="assignees-edit"
            aria-label="Edit assignees"
            title="Edit assignees"
            aria-expanded={pickerOpen}
            disabled={busy}
            onClick={() => (pickerOpen ? closePicker() : setPickerOpen(true))}
          />
        )}
      </div>
      {canEdit && pickerOpen && (
        <AssigneePicker
          assignees={pr.assignees}
          flipped={flipped}
          listAssignees={listAssignees}
          onFlip={(user) =>
            setFlipped((current) => {
              const next = new Map(current);
              if (!next.delete(user.login)) next.set(user.login, user);
              return next;
            })
          }
          onClose={closePicker}
        />
      )}
      {/* GitHub's own card says so, and assigns the viewer from it. */}
      {pr.assignees.length === 0 && !pickerOpen && (
        <div className="pr-muted">
          No one —{' '}
          <button className="side-assign-yourself" disabled={busy} onClick={() => void save(() => onModify([viewerLogin], []))}>
            assign yourself
          </button>
        </div>
      )}
      <ul className="side-list">
        {pr.assignees.map((user) => (
          <li key={user.login} className="side-person">
            <Avatar user={user} size={20} />
            <span className="side-person-name">{user.login}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * GitHub's assignees menu: the people it offers, narrowed by login or name as the viewer types, at most 30 at a time as
 * GitHub's menu shows them. A tick means "assigned". Esc or a click outside closes it, like Done.
 */
function AssigneePicker({
  assignees,
  flipped,
  listAssignees,
  onFlip,
  onClose,
}: {
  assignees: UserRef[];
  flipped: ReadonlyMap<string, AssigneeCandidate>;
  listAssignees: () => Promise<AssigneeCandidate[]>;
  onFlip: (user: AssigneeCandidate) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<AssigneeCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The parent hands over new functions on every render; neither a new load nor new listeners should follow from that.
  const latest = useRef({ listAssignees, onClose });
  latest.current = { listAssignees, onClose };

  useEffect(() => {
    let cancelled = false;
    // GitHub's menu loads everyone it offers at once and narrows them as the viewer types, without asking again.
    latest.current.listAssignees().then(
      (found) => !cancelled && setPeople(found),
      (reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // The gear closes the picker itself.
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.assignee-picker, .assignees-edit')) latest.current.onClose();
    };
    // Captured ahead of the page's keybindings, which then leave this Escape alone.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      latest.current.onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  const needle = query.trim().toLowerCase();
  const shown = people && people.filter((user) => user.login.toLowerCase().includes(needle) || !!user.name?.toLowerCase().includes(needle)).slice(0, 30);
  const topMatch = shown?.[0];

  return (
    // The reviewer picker's look (reviewers.css); `assignee-picker` tells its clicks apart.
    <div className="reviewer-picker assignee-picker" role="dialog" aria-label="Edit assignees">
      <input
        className="reviewer-picker-search"
        type="search"
        value={query}
        placeholder="Filter people"
        aria-label="Filter people"
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Enter flips the top match, so a few letters and Enter is all it takes.
          if (event.key !== 'Enter' || !topMatch) return;
          event.preventDefault();
          onFlip(topMatch);
        }}
      />
      <div className="reviewer-picker-list" aria-busy={people === null && error === null}>
        {error && <div className="reviewer-picker-note pr-fg-danger">{error}</div>}
        {!people && !error && <div className="reviewer-picker-note pr-muted">Loading…</div>}
        {shown?.length === 0 && <div className="reviewer-picker-note pr-muted">No one matches</div>}
        {shown?.map((user) => (
          <label key={user.login} className="reviewer-option">
            <input type="checkbox" checked={isAssigned(assignees, user) !== flipped.has(user.login)} onChange={() => onFlip(user)} />
            <Avatar user={user} size={20} />
            <span className="reviewer-option-login">{user.login}</span>
            {user.name && <span className="reviewer-option-name pr-muted">{user.name}</span>}
          </label>
        ))}
      </div>
      <div className="reviewer-picker-actions">
        <span className="pr-muted">{flipped.size > 0 ? `${flipped.size} to save` : 'Enter ticks the top match'}</span>
        <Button size="sm" variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** Whether this person is one of the PR's assignees. */
function isAssigned(assignees: UserRef[], user: AssigneeCandidate): boolean {
  return assignees.some((assignee) => assignee.login === user.login);
}
