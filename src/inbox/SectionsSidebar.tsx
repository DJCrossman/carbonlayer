// Graphite's sections sidebar: every inbox section of the organization shown, which heads it, with its count, the one in
// view highlighted; a click scrolls to it. Each row has ↑ / ↓ to reorder and a gear for the section editor; "Add section"
// at the bottom opens it for a new one. Below it, the viewer's top repositories, as GitHub's homepage lists them.
import { useId, type MouseEvent } from 'react';
import type { Organization, TopRepository, View, ViewResult } from '../lib/model';
import { sectionCount } from '../lib/views';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import './sections-sidebar.css';

export function SectionsSidebar({
  org,
  views,
  resultsByView,
  currentViewId,
  open,
  onSelect,
  onMove,
  onEdit,
  onAdd,
  onHide,
  topRepositories,
  onShowMoreRepositories,
  onOpen,
}: {
  /** Whose sections these are. */
  org: Organization;
  views: View[];
  resultsByView: Map<string, ViewResult>;
  currentViewId: string | null;
  /** Shown over the inbox on a narrow window. */
  open: boolean;
  onSelect: (view: View) => void;
  onMove: (index: number, offset: -1 | 1) => void;
  onEdit: (view: View) => void;
  onAdd: () => void;
  onHide: () => void;
  /** The repositories GitHub's homepage lists, as far as "Show more" has gone. */
  topRepositories: { repos: TopRepository[]; canShowMore: boolean; loading: boolean; error: string | null };
  onShowMoreRepositories: () => void;
  /** Opens a page on GitHub in the top window, or in a new tab. */
  onOpen: (url: string, newTab: boolean) => void;
}) {
  const reposHeadingId = useId();
  // A plain click opens the link through the parent page, ⌘ / Ctrl-click in a new tab; middle-click and "Copy link" keep
  // the link's own behaviour because they never fire `click`.
  const openOnGitHub = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onOpen(event.currentTarget.href, event.metaKey || event.ctrlKey);
  };
  return (
    <aside className={open ? 'gg-sidebar is-open' : 'gg-sidebar'} aria-label="Sections">
      <header className="gg-sidebar__header">
        <span className={org.isViewer ? 'gg-sidebar__org' : 'gg-sidebar__org is-organization'}>
          <a className="gg-sidebar__org-link" href={`https://github.com/${org.login}`} title={`Open ${org.login} on GitHub`} onClick={openOnGitHub}>
            <Avatar user={{ login: org.login, avatarUrl: org.avatarUrl, url: `https://github.com/${org.login}` }} size={16} title={`Open ${org.login} on GitHub`} />
            <span className="gg-sidebar__org-name">{org.login}</span>
          </a>
        </span>
        <Button variant="ghost" size="sm" icon="sidebar" aria-label="Hide sections" title="Hide sections" onClick={onHide} />
      </header>
      <ol className="gg-sidebar__list">
        {views.map((view, index) => {
          const result = resultsByView.get(view.id);
          return (
            <li key={view.id} className={view.id === currentViewId ? 'gg-sidebar__item is-current' : 'gg-sidebar__item'}>
              <button type="button" className="gg-sidebar__link" aria-current={view.id === currentViewId ? 'location' : undefined} onClick={() => onSelect(view)}>
                <span className="gg-sidebar__name">{view.name}</span>
                {result && !result.error && <span className="gg-sidebar__count">{sectionCount(result)}</span>}
              </button>
              <span className="gg-sidebar__tools">
                <Button variant="ghost" size="sm" icon="arrow-up" aria-label={`Move ${view.name} up`} title="Move up" disabled={index === 0} onClick={() => onMove(index, -1)} />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="arrow-down"
                  aria-label={`Move ${view.name} down`}
                  title="Move down"
                  disabled={index === views.length - 1}
                  onClick={() => onMove(index, 1)}
                />
                <Button variant="ghost" size="sm" icon="gear" aria-label={`Edit ${view.name}`} title="Edit section" onClick={() => onEdit(view)} />
              </span>
            </li>
          );
        })}
      </ol>
      <button type="button" className="gg-sidebar__add" onClick={onAdd}>
        <Icon name="plus" size={14} />
        Add section
      </button>
      <section className="gg-sidebar__repos" aria-labelledby={reposHeadingId}>
        <div className="gg-sidebar__repos-header">
          <h3 id={reposHeadingId} className="gg-sidebar__repos-title">
            Top repositories
          </h3>
          <a className="gg-sidebar__repos-new" href="https://github.com/new" title="Create a new repository on GitHub" onClick={openOnGitHub}>
            New
          </a>
        </div>
        <ul className="gg-sidebar__repo-list">
          {topRepositories.loading && topRepositories.repos.length === 0
            ? [72, 56, 64].map((width) => (
                <li key={width} className="gg-sidebar__repo-skeleton" aria-hidden>
                  <Skeleton width={16} height={16} />
                  <Skeleton width={`${width}%`} />
                </li>
              ))
            : topRepositories.repos.map((repo) => (
                <li key={repo.url}>
                  <a className="gg-sidebar__repo" href={repo.url} title={`${repo.owner}/${repo.name}`} onClick={openOnGitHub}>
                    <Avatar user={{ login: repo.owner, avatarUrl: repo.avatarUrl ?? '', url: `https://github.com/${repo.owner}` }} size={16} title={`${repo.owner}/${repo.name}`} />
                    <span className="gg-sidebar__repo-name">
                      <span className="gg-sidebar__repo-owner">{repo.owner}/</span>
                      {repo.name}
                    </span>
                  </a>
                </li>
              ))}
        </ul>
        {topRepositories.error && (
          <p className="gg-sidebar__repos-error" title={topRepositories.error}>
            Could not load repositories: {topRepositories.error}
          </p>
        )}
        {topRepositories.canShowMore && (
          <button type="button" className="gg-sidebar__add" disabled={topRepositories.loading} onClick={onShowMoreRepositories}>
            {topRepositories.loading ? 'Loading…' : 'Show more'}
          </button>
        )}
      </section>
    </aside>
  );
}
