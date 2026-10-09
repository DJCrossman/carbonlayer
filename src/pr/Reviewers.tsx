// The sidebar's Reviewers card: who is asked to review and where they stand, and GitHub's controls for changing that.
// The gear (or r e) opens a picker whose ticks are sent as one change when it closes; × withdraws a pending request;
// ↻ asks someone who already reviewed to look again. Every change is followed by a refetch, which shows the outcome.
import { useEffect, useRef, useState } from 'react';
import type { ReviewerChange } from '../app/data-source';
import type { PrDetail, ReviewerCandidate, ReviewerSummary } from '../lib/model';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { ReviewStatus } from '../ui/ReviewStatus';
import './reviewers.css';

export function ReviewersCard({
  pr,
  pickerOpen,
  onPickerOpenChange,
  searchReviewers,
  onModify,
  onReRequest,
}: {
  pr: PrDetail;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  searchReviewers: (query: string) => Promise<{ suggested: ReviewerCandidate[]; reviewers: ReviewerCandidate[] }>;
  onModify: (add: ReviewerChange[], remove: ReviewerChange[]) => Promise<boolean>;
  onReRequest: (reviewer: ReviewerSummary & { id: string }) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  /** Picker rows whose tick the viewer flipped, by candidate id; sent when the picker closes. */
  const [flipped, setFlipped] = useState<ReadonlyMap<string, ReviewerCandidate>>(new Map());
  // GitHub lets whoever can edit the PR change its reviewers, while it is open.
  const canEdit = pr.viewerCanUpdate && pr.state === 'OPEN';
  if (pr.reviewers.length === 0 && !canEdit) return null;

  async function save(work: () => Promise<boolean>) {
    setBusy(true);
    await work();
    setBusy(false);
  }

  function closePicker() {
    onPickerOpenChange(false);
    setFlipped(new Map());
    const changed = [...flipped.values()];
    const add = changed.filter((candidate) => !askedFor(pr.reviewers, candidate)).map((candidate) => ({ id: candidate.id, isTeam: candidate.kind === 'team' }));
    const remove = changed.filter((candidate) => askedFor(pr.reviewers, candidate)).map((candidate) => ({ id: candidate.id, isTeam: candidate.kind === 'team' }));
    if (add.length > 0 || remove.length > 0) void save(() => onModify(add, remove));
  }

  return (
    <Card className="side-card">
      <div className="side-card-head">
        <h3 className="side-card-title">
          Reviewers {busy && <span className="pr-muted">· saving…</span>}
        </h3>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            icon="gear"
            className="reviewers-edit"
            aria-label="Edit reviewers"
            title="Edit reviewers (r e)"
            aria-expanded={pickerOpen}
            disabled={busy}
            onClick={() => (pickerOpen ? closePicker() : onPickerOpenChange(true))}
          />
        )}
      </div>
      {canEdit && pickerOpen && (
        <ReviewerPicker
          reviewers={pr.reviewers}
          flipped={flipped}
          searchReviewers={searchReviewers}
          onFlip={(candidate) =>
            setFlipped((current) => {
              const next = new Map(current);
              if (!next.delete(candidate.id)) next.set(candidate.id, candidate);
              return next;
            })
          }
          onClose={closePicker}
        />
      )}
      {pr.reviewers.length === 0 && !pickerOpen && <div className="pr-muted">No reviewers yet</div>}
      <ul className="side-list">
        {pr.reviewers.map((reviewer) => {
          const { id } = reviewer;
          return (
            <li key={reviewer.user.login} className="side-person">
              {reviewer.kind === 'team' ? (
                <span className="side-team-icon">
                  <Icon name="people" size={12} />
                </span>
              ) : (
                <Avatar user={reviewer.user} size={20} />
              )}
              <span className="side-person-name">{reviewer.user.login}</span>
              {id && reviewer.canReRequest && (
                <button
                  className="reviewer-action"
                  title="Re-request review"
                  aria-label={`Re-request review from ${reviewer.user.login}`}
                  disabled={busy}
                  onClick={() => void save(() => onReRequest({ ...reviewer, id }))}
                >
                  <Icon name="sync" size={12} />
                </button>
              )}
              {id && canEdit && reviewer.state === 'PENDING' && (
                <button
                  className="reviewer-action"
                  title="Remove review request"
                  aria-label={`Remove the review request for ${reviewer.user.login}`}
                  disabled={busy}
                  onClick={() => void save(() => onModify([], [{ id, isTeam: reviewer.kind === 'team' }]))}
                >
                  <Icon name="x" size={12} />
                </button>
              )}
              <ReviewStatus state={reviewer.state} size={14} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * GitHub's reviewer picker: its suggestions, then everyone else matching the search. A tick means "asked to review"; who
 * already reviewed stays ticked and locked (↻ asks them again). Esc or a click outside closes it, like Done.
 */
function ReviewerPicker({
  reviewers,
  flipped,
  searchReviewers,
  onFlip,
  onClose,
}: {
  reviewers: ReviewerSummary[];
  flipped: ReadonlyMap<string, ReviewerCandidate>;
  searchReviewers: (query: string) => Promise<{ suggested: ReviewerCandidate[]; reviewers: ReviewerCandidate[] }>;
  onFlip: (candidate: ReviewerCandidate) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; suggested: ReviewerCandidate[]; reviewers: ReviewerCandidate[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The parent hands over new functions on every render; neither a new search nor new listeners should follow from that.
  const latest = useRef({ searchReviewers, onClose });
  latest.current = { searchReviewers, onClose };

  useEffect(() => {
    let cancelled = false;
    // The first list comes at once; typing waits for a 200 ms pause, as GitHub's picker does.
    const timer = setTimeout(
      () =>
        latest.current.searchReviewers(query.trim()).then(
          (result) => {
            if (cancelled) return;
            setFound({ query, ...result });
            setError(null);
          },
          (reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)),
        ),
      query ? 200 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    // The gear closes the picker itself.
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.reviewer-picker, .reviewers-edit')) latest.current.onClose();
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

  // Who already reviewed cannot be unticked: GitHub only withdraws requests.
  const isLocked = (candidate: ReviewerCandidate) => (askedFor(reviewers, candidate)?.state ?? 'PENDING') !== 'PENDING';
  const topMatch = found && [...found.suggested, ...found.reviewers].find((candidate) => !isLocked(candidate));

  return (
    <div className="reviewer-picker" role="dialog" aria-label="Edit reviewers">
      <input
        className="reviewer-picker-search"
        type="search"
        value={query}
        placeholder="Search people and teams"
        aria-label="Search people and teams"
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Enter flips the top match, so a few letters and Enter is all it takes.
          if (event.key !== 'Enter' || !topMatch) return;
          event.preventDefault();
          onFlip(topMatch);
        }}
      />
      <div className="reviewer-picker-list" aria-busy={found?.query !== query}>
        {error && <div className="reviewer-picker-note pr-fg-danger">{error}</div>}
        {!found && !error && <div className="reviewer-picker-note pr-muted">Loading…</div>}
        {found && found.suggested.length + found.reviewers.length === 0 && <div className="reviewer-picker-note pr-muted">No one matches</div>}
        {found &&
          (
            [
              ['Suggestions', found.suggested],
              ['Everyone else', found.reviewers],
            ] as const
          ).map(([title, candidates]) =>
            candidates.length === 0 ? null : (
              <div key={title} role="group" aria-label={title}>
                <div className="reviewer-picker-group">{title}</div>
                {candidates.map((candidate) => {
                  const locked = isLocked(candidate);
                  return (
                    <label key={candidate.id} className={`reviewer-option${locked ? ' is-locked' : ''}`} title={locked ? 'Already reviewed; ↻ in the list asks again' : undefined}>
                      <input
                        type="checkbox"
                        checked={!!askedFor(reviewers, candidate) !== flipped.has(candidate.id)}
                        disabled={locked}
                        onChange={() => onFlip(candidate)}
                      />
                      {candidate.kind === 'team' ? (
                        <span className="side-team-icon">
                          <Icon name="people" size={12} />
                        </span>
                      ) : (
                        <Avatar user={{ login: candidate.login, avatarUrl: candidate.avatarUrl, url: '' }} size={20} />
                      )}
                      <span className="reviewer-option-login">{candidate.login}</span>
                      {candidate.name && <span className="reviewer-option-name pr-muted">{candidate.name}</span>}
                    </label>
                  );
                })}
              </div>
            ),
          )}
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

/** The PR's reviewer this candidate already is, if any: requested, or done reviewing. */
function askedFor(reviewers: ReviewerSummary[], candidate: ReviewerCandidate): ReviewerSummary | undefined {
  return reviewers.find((reviewer) => reviewer.id === candidate.id || reviewer.user.login === candidate.login);
}
