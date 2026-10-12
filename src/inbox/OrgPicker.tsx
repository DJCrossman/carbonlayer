// Organizations, which the inbox shows one at a time. `OrgPicker` is the selector: a button naming the organization the
// inbox shows (its avatar and login; a chip in the inbox's top bar, a form field on the options page) that opens the list
// of the viewer's organizations, their own account last. `OrgChooser` is the same list as the inbox's first screen,
// while no organization is chosen, offering to keep the views saved before views belonged to one.
import { useEffect, useId, useRef, useState } from 'react';
import type { Organization } from '../lib/model';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import './org-picker.css';

export function OrgPicker({
  organizations,
  current,
  chip,
  onChange,
}: {
  organizations: OrganizationsLoad;
  current: Organization | null;
  /** A pill, as in the inbox's top bar, rather than a form field. */
  chip?: boolean;
  onChange: (org: Organization) => void;
}) {
  const popoverId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  return (
    <div ref={root} className={chip ? 'gg-org-picker is-chip' : 'gg-org-picker'}>
      <button
        type="button"
        className="gg-org-picker__button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        title={current ? `The inbox shows ${current.isViewer ? 'your own repositories' : `${current.login}'s pull requests`}; choose another organization` : 'Choose an organization'}
        onClick={() => setOpen(!open)}
      >
        {current ? <OrgAvatar org={current} size={16} /> : <Icon name="organization" size={14} />}
        <span className="gg-org-picker__label">{current?.login ?? 'Choose an organization'}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {open && (
        <div
          id={popoverId}
          className="gg-org-picker__popover"
          role="dialog"
          aria-label="Organizations"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            // Esc closes the list, not what is around it.
            event.stopPropagation();
            setOpen(false);
          }}
        >
          <OrganizationList
            organizations={organizations}
            current={current}
            autoFocus
            onChoose={(org) => {
              setOpen(false);
              if (org.login !== current?.login) onChange(org);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** The inbox's first screen, before an organization is chosen (or once GitHub no longer lists the one that was). */
export function OrgChooser({
  organizations,
  viewsUnassigned,
  onChoose,
}: {
  organizations: OrganizationsLoad;
  /** Whether there are views saved before views belonged to an organization, which the one chosen may keep. */
  viewsUnassigned: boolean;
  onChoose: (org: Organization, keepViews: boolean) => void;
}) {
  const [keepViews, setKeepViews] = useState(true);
  return (
    <section className="gg-org-chooser" aria-labelledby="gg-org-chooser-title">
      <h2 id="gg-org-chooser-title" className="gg-org-chooser__title">
        Choose an organization
      </h2>
      <p className="gg-org-chooser__hint">The inbox shows one organization's pull requests at a time, each with its own sections and repositories.</p>
      <OrganizationList organizations={organizations} current={null} autoFocus onChoose={(org) => onChoose(org, viewsUnassigned && keepViews)} />
      {viewsUnassigned && (
        <label className="gg-org-chooser__keep">
          <input type="checkbox" checked={keepViews} onChange={(event) => setKeepViews(event.target.checked)} />
          Keep my current views for this organization
        </label>
      )}
    </section>
  );
}

/** The organizations as loaded (`useOrganizations`): the list, or why it did not load and a way to ask again, or null while loading. */
export type OrganizationsLoad = { list: Organization[] | null; error: string | null; retry: () => void };

/** The viewer's organizations, asked for once (the content script keeps them 10 minutes), and again on `retry`. */
export function useOrganizations(listOrgs: () => Promise<Organization[]>): OrganizationsLoad {
  const [list, setList] = useState<Organization[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    listOrgs().then(
      (found) => {
        if (!current) return;
        setList(found);
        setError(null);
      },
      (cause: unknown) => current && setError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      current = false;
    };
  }, [attempt]);
  return { list, error, retry: () => setAttempt(attempt + 1) };
}

function OrganizationList({
  organizations,
  current,
  autoFocus,
  onChoose,
}: {
  organizations: OrganizationsLoad;
  current: Organization | null;
  autoFocus?: boolean;
  onChoose: (org: Organization) => void;
}) {
  const { list, error, retry } = organizations;
  if (error && !list) {
    return (
      <p className="gg-org-picker__status" role="alert">
        Your organizations did not load ({error}).{' '}
        <Button size="sm" variant="ghost" onClick={retry}>
          Try again
        </Button>
      </p>
    );
  }
  if (!list) return <p className="gg-org-picker__status">Loading your organizations…</p>;
  if (list.length === 0) return <p className="gg-org-picker__status">GitHub lists no organizations for you. Sign in to github.com, then reload.</p>;
  return (
    <ul className="gg-org-picker__list">
      {list.map((org, index) => (
        <li key={org.login}>
          <button
            type="button"
            className="gg-org-picker__item"
            aria-pressed={org.login === current?.login}
            autoFocus={autoFocus && (current ? org.login === current.login : index === 0)}
            onClick={() => onChoose(org)}
          >
            <OrgAvatar org={org} size={20} />
            <span className="gg-org-picker__name">{org.login}</span>
            {org.isViewer && <span className="gg-org-picker__note">Your account</span>}
            {org.login === current?.login && <Icon name="check" size={14} className="gg-org-picker__check" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** An organization's avatar is a rounded square, a person's a circle, as on GitHub. */
function OrgAvatar({ org, size }: { org: Organization; size: number }) {
  return (
    <span className={org.isViewer ? 'gg-org-picker__avatar' : 'gg-org-picker__avatar is-organization'}>
      <Avatar user={{ login: org.login, avatarUrl: org.avatarUrl, url: `https://github.com/${org.login}` }} size={size} />
    </span>
  );
}
