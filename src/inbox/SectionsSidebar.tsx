// Graphite's sections sidebar: every inbox section of the organization shown, which heads it, with its count, the one in
// view highlighted; a click scrolls to it. Each row has ↑ / ↓ to reorder and a gear for the section editor; "Add section"
// at the bottom opens it for a new one.
import type { Organization, View, ViewResult } from '../lib/model';
import { sectionCount } from '../lib/views';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
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
}) {
  return (
    <aside className={open ? 'gg-sidebar is-open' : 'gg-sidebar'} aria-label="Sections">
      <header className="gg-sidebar__header">
        <span className={org.isViewer ? 'gg-sidebar__org' : 'gg-sidebar__org is-organization'} title={`${org.login}'s sections`}>
          <Avatar user={{ login: org.login, avatarUrl: org.avatarUrl, url: `https://github.com/${org.login}` }} size={16} title={org.login} />
          <span className="gg-sidebar__org-name">{org.login}</span>
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
                {result && <span className="gg-sidebar__count">{sectionCount(result)}</span>}
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
      <a className="gg-sidebar__support" href="https://buymeacoffee.com/djcrossman" target="_blank" rel="noopener">
        <img src="/buymeacoffee.png" alt="Buy me a coffee" height={32} />
      </a>
    </aside>
  );
}
