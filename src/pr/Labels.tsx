// The sidebar's Labels card: the PR's labels, and GitHub's labels menu for changing them. The gear opens a picker of the
// repository's labels whose ticks are sent as one change when it closes; the change is followed by a refetch, which
// shows the outcome.
import { useEffect, useRef, useState } from 'react';
import type { LabelCandidate, LabelSummary, PrDetail } from '../lib/model';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LabelChip } from '../ui/LabelChip';
import './reviewers.css';

export function LabelsCard({
  pr,
  listLabels,
  onModify,
}: {
  pr: PrDetail;
  listLabels: () => Promise<LabelCandidate[]>;
  onModify: (add: string[], remove: string[]) => Promise<boolean>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Picker rows whose tick the viewer flipped, by label id; sent when the picker closes. */
  const [flipped, setFlipped] = useState<ReadonlyMap<string, LabelCandidate>>(new Map());
  // GitHub lets whoever can edit the PR change its labels.
  const canEdit = pr.viewerCanUpdate;
  if (pr.labels.length === 0 && !canEdit) return null;

  function closePicker() {
    setPickerOpen(false);
    setFlipped(new Map());
    const changed = [...flipped.values()];
    const add = changed.filter((label) => !isApplied(pr.labels, label)).map((label) => label.id);
    const remove = changed.filter((label) => isApplied(pr.labels, label)).map((label) => label.id);
    if (add.length === 0 && remove.length === 0) return;
    setBusy(true);
    void onModify(add, remove).then(() => setBusy(false));
  }

  return (
    <Card className="side-card">
      <div className="side-card-head">
        <h3 className="side-card-title">
          Labels {busy && <span className="pr-muted">· saving…</span>}
        </h3>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            icon="gear"
            className="labels-edit"
            aria-label="Edit labels"
            title="Edit labels"
            aria-expanded={pickerOpen}
            disabled={busy}
            onClick={() => (pickerOpen ? closePicker() : setPickerOpen(true))}
          />
        )}
      </div>
      {canEdit && pickerOpen && (
        <LabelPicker
          applied={pr.labels}
          flipped={flipped}
          listLabels={listLabels}
          onFlip={(label) =>
            setFlipped((current) => {
              const next = new Map(current);
              if (!next.delete(label.id)) next.set(label.id, label);
              return next;
            })
          }
          onClose={closePicker}
        />
      )}
      {pr.labels.length === 0 && !pickerOpen && <div className="pr-muted">None yet</div>}
      <div className="side-labels">
        {pr.labels.map((label) => (
          <LabelChip key={label.name} label={label} />
        ))}
      </div>
    </Card>
  );
}

/**
 * GitHub's labels menu: every label of the repository with its colour and description, narrowed by name as the viewer
 * types. A tick means "on the PR". Esc or a click outside closes it, like Done.
 */
function LabelPicker({
  applied,
  flipped,
  listLabels,
  onFlip,
  onClose,
}: {
  applied: LabelSummary[];
  flipped: ReadonlyMap<string, LabelCandidate>;
  listLabels: () => Promise<LabelCandidate[]>;
  onFlip: (label: LabelCandidate) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [labels, setLabels] = useState<LabelCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The parent hands over new functions on every render; neither a new load nor new listeners should follow from that.
  const latest = useRef({ listLabels, onClose });
  latest.current = { listLabels, onClose };

  useEffect(() => {
    let cancelled = false;
    // GitHub's menu loads every label at once and narrows them as the viewer types, without asking again.
    latest.current.listLabels().then(
      (found) => !cancelled && setLabels(found),
      (reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // The gear closes the picker itself.
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.label-picker, .labels-edit')) latest.current.onClose();
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
  const shown = labels && labels.filter((label) => label.name.toLowerCase().includes(needle));
  const topMatch = shown?.[0];

  return (
    // The reviewer picker's look (reviewers.css); `label-picker` tells its clicks apart.
    <div className="reviewer-picker label-picker" role="dialog" aria-label="Edit labels">
      <input
        className="reviewer-picker-search"
        type="search"
        value={query}
        placeholder="Filter labels"
        aria-label="Filter labels"
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Enter flips the top match, so a few letters and Enter is all it takes.
          if (event.key !== 'Enter' || !topMatch) return;
          event.preventDefault();
          onFlip(topMatch);
        }}
      />
      <div className="reviewer-picker-list" aria-busy={labels === null && error === null}>
        {error && <div className="reviewer-picker-note pr-fg-danger">{error}</div>}
        {!labels && !error && <div className="reviewer-picker-note pr-muted">Loading…</div>}
        {shown?.length === 0 && <div className="reviewer-picker-note pr-muted">No labels match</div>}
        {shown?.map((label) => (
          <label key={label.id} className="reviewer-option" title={label.description ?? undefined}>
            <input type="checkbox" checked={isApplied(applied, label) !== flipped.has(label.id)} onChange={() => onFlip(label)} />
            <span className="label-option-color" style={{ background: `#${label.color}` }} aria-hidden="true" />
            <span className="reviewer-option-login">{label.name}</span>
            {label.description && <span className="reviewer-option-name pr-muted">{label.description}</span>}
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

/** Whether the PR has this label, as the card's labels (which carry no id) say. */
function isApplied(labels: LabelSummary[], label: LabelCandidate): boolean {
  return labels.some((applied) => applied.name === label.name);
}
