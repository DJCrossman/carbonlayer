// GitHub's repository picker as a multi-select: a button naming the choice opens a popover with a search box, "Select
// all / none" and one checkbox per repository (owner/name, a lock on private ones). The candidates are the ones GitHub's
// own picker offers (`searchRepos`); typing owner/name offers that repository too, should GitHub's list lack it. The
// choice is applied when the popover closes. Picks the inbox scope and a section's own repositories.
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import type { RepoCandidate, RepoRef } from '../lib/model';
import { Icon } from '../ui/Icon';
import './repo-picker.css';

export function RepoPicker({
  selected,
  emptyLabel,
  chip,
  title,
  searchRepos,
  onChange,
}: {
  selected: RepoRef[];
  /** What the button says when no repository is chosen. */
  emptyLabel: string;
  /** A pill, as in the inbox's top bar, rather than a form field. */
  chip?: boolean;
  title?: string;
  searchRepos: (query: string) => Promise<RepoCandidate[]>;
  onChange: (repos: RepoRef[]) => void;
}) {
  const popoverId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RepoRef[]>(selected);
  const [text, setText] = useState('');
  // GitHub's answer for the text typed, or why there is none.
  const [found, setFound] = useState<{ repos: RepoCandidate[] } | { error: string } | null>(null);

  function close() {
    setOpen(false);
    const changed = draft.length !== selected.length || draft.some((repo) => !selected.some((other) => other.owner === repo.owner && other.name === repo.name));
    if (changed) onChange(draft);
  }
  const search = useEffectEvent((query: string) => searchRepos(query));

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
    // Again with every change to the choice, which closing applies.
  }, [open, draft]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    // GitHub is asked once typing pauses.
    const timer = setTimeout(
      () =>
        search(text.trim()).then(
          (repos) => current && setFound({ repos }),
          (cause: unknown) => current && setFound({ error: cause instanceof Error ? cause.message : String(cause) }),
        ),
      text ? 250 : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, text]);

  const results = found && 'repos' in found ? found.repos : [];
  // The chosen repositories GitHub did not list stay offered, so they can be unchosen, while nothing is typed.
  const listed: Array<RepoRef & { isPrivate?: boolean }> = [
    ...(text.trim() ? [] : draft.filter((repo) => !results.some((other) => other.owner === repo.owner && other.name === repo.name))),
    ...results,
  ];
  const typed = /^[\w.-]+\/[\w.-]+$/.test(text.trim()) ? { owner: text.trim().split('/')[0]!, name: text.trim().split('/')[1]! } : null;
  if (typed && !listed.some((repo) => repo.owner.toLowerCase() === typed.owner.toLowerCase() && repo.name.toLowerCase() === typed.name.toLowerCase())) listed.push(typed);
  const label = selected.length === 0 ? emptyLabel : `${selected[0]!.owner}/${selected[0]!.name}${selected.length > 1 ? ` +${selected.length - 1}` : ''}`;

  return (
    <div ref={root} className={chip ? 'gg-repo-picker is-chip' : 'gg-repo-picker'}>
      <button
        type="button"
        className="gg-repo-picker__button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        title={title ?? selected.map((repo) => `${repo.owner}/${repo.name}`).join(', ')}
        onClick={() => {
          if (open) return close();
          setDraft(selected);
          setText('');
          setFound(null);
          setOpen(true);
        }}
      >
        <Icon name="repo" size={14} />
        <span className="gg-repo-picker__label">{label}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {open && (
        <div
          id={popoverId}
          className="gg-repo-picker__popover"
          role="dialog"
          aria-label="Repositories"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            // Esc closes the picker, not the drawer or dialog around it.
            event.stopPropagation();
            close();
          }}
        >
          <input
            type="search"
            className="gg-repo-picker__search"
            autoFocus
            value={text}
            placeholder="Search repositories, or type owner/name"
            aria-label="Search repositories"
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="gg-repo-picker__bar">
            <button type="button" onClick={() => setDraft([...draft, ...listed.filter((repo) => !draft.some((other) => other.owner === repo.owner && other.name === repo.name))].map(({ owner, name }) => ({ owner, name })))}>
              Select all
            </button>
            <button type="button" onClick={() => setDraft([])}>
              Select none
            </button>
            <span className="gg-repo-picker__status">
              {found === null ? 'Searching…' : 'error' in found ? '' : `${draft.length} selected`}
            </span>
          </div>
          {found && 'error' in found && (
            <p className="gg-repo-picker__error" role="alert">
              GitHub's repository list did not load ({found.error}). Type owner/name to choose one.
            </p>
          )}
          <ul className="gg-repo-picker__list">
            {listed.map((repo) => {
              const checked = draft.some((other) => other.owner === repo.owner && other.name === repo.name);
              return (
                <li key={`${repo.owner}/${repo.name}`}>
                  <label className="gg-repo-picker__item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setDraft(checked ? draft.filter((other) => other.owner !== repo.owner || other.name !== repo.name) : [...draft, { owner: repo.owner, name: repo.name }])
                      }
                    />
                    <Icon name={repo.isPrivate ? 'lock' : 'repo'} size={14} title={repo.isPrivate === undefined ? undefined : repo.isPrivate ? 'Private' : 'Public'} />
                    <span className="gg-repo-picker__name">
                      <span className="gg-repo-picker__owner">{repo.owner}/</span>
                      {repo.name}
                    </span>
                  </label>
                </li>
              );
            })}
            {found && 'repos' in found && listed.length === 0 && <li className="gg-repo-picker__empty">No repositories match.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
