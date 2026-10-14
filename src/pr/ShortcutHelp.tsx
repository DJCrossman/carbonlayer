// The shortcut legend pinned to the bottom of the page (as Graphite does) and the full list behind `?`.
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { PR_KEYBINDINGS, parseChord } from './keybindings';
import './shortcuts.css';

export function ShortcutLegend({ onHide, onShowAll }: { onHide: () => void; onShowAll: () => void }) {
  return (
    <div className="shortcut-legend" role="note" aria-label="Keyboard shortcuts">
      {PR_KEYBINDINGS.filter((binding) => binding.legend).map((binding) =>
        binding.action === 'help' ? (
          <button key={binding.chord} className="shortcut-legend-item is-button" onClick={onShowAll}>
            <ChordKeys chord={binding.chord} />
            All shortcuts
          </button>
        ) : (
          <span key={binding.chord} className="shortcut-legend-item">
            <ChordKeys chord={binding.chord} />
            {binding.label}
          </span>
        ),
      )}
      <button className="shortcut-legend-hide" onClick={onHide} title="Hide the shortcut bar (? shows all shortcuts)">
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

export function ShortcutHelp({ legendHidden, onShowLegend, onClose }: { legendHidden: boolean; onShowLegend: () => void; onClose: () => void }) {
  return (
    <div className="pr-overlay" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="pr-dialog shortcut-help" role="dialog" aria-label="Keyboard shortcuts">
        <div className="pr-dialog-title">Keyboard shortcuts</div>
        <dl className="shortcut-list">
          {PR_KEYBINDINGS.map((binding) => (
            <div key={binding.chord} className="shortcut-row">
              <dt>{binding.label}</dt>
              <dd>
                <ChordKeys chord={binding.chord} />
              </dd>
            </div>
          ))}
          <div className="shortcut-row">
            <dt>Submit the focused comment or review</dt>
            <dd>
              <ChordKeys chord="mod+Enter" />
            </dd>
          </div>
        </dl>
        {legendHidden && (
          <Button size="sm" onClick={onShowLegend}>
            Show the shortcut bar again
          </Button>
        )}
      </div>
    </div>
  );
}

function ChordKeys({ chord }: { chord: string }) {
  const isMac = navigator.userAgent.includes('Mac');
  return (
    <span className="chord-keys">
      {parseChord(chord).map((stroke, index) => (
        <Kbd key={index}>
          {stroke.mod ? (isMac ? '⌘' : 'Ctrl+') : ''}
          {stroke.shift ? '⇧' : ''}
          {stroke.alt ? (isMac ? '⌥' : 'Alt+') : ''}
          {/* ⌘C as menus write it; a key on its own stays as typed, since c and C are different bindings. */}
          {({ ArrowDown: '↓', ArrowUp: '↑', Escape: 'Esc', Enter: '↵' } as Record<string, string>)[stroke.key] ?? (stroke.mod ? stroke.key.toUpperCase() : stroke.key)}
        </Kbd>
      ))}
    </span>
  );
}
