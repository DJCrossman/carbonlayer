// The inbox's keyboard shortcut overlay (`?`); Esc, the close button or a click outside closes it.
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="gg-help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="gg-help__panel" onClick={(event) => event.stopPropagation()}>
        <header className="gg-help__header">
          Keyboard shortcuts
          <Button variant="ghost" size="sm" icon="x" aria-label="Close" onClick={onClose} />
        </header>
        <dl className="gg-help__list">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={action} className="gg-help__row">
              <dt>
                {keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

const SHORTCUTS: Array<[keys: string[], action: string]> = [
  [['j'], 'Next pull request'],
  [['k'], 'Previous pull request'],
  [['o', '↵'], 'Open pull request'],
  [['⇧O', '⇧↵'], 'Open in a new tab'],
  [['c'], 'Collapse or expand the section'],
  [['r'], 'Refresh'],
  [['?'], 'Show or hide shortcuts'],
  [['esc'], 'Close'],
];
