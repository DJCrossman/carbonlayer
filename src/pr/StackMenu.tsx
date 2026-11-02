// The ⋯ at the end of the stack card's header, with Graphite's items.
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Settings } from '../lib/settings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

/**
 * Graphite's stack menu: View settings, which opens the options page as the inbox's settings button does, then Show merged
 * PRs and Show closed PRs, each checked while the card draws the stack's PRs in that state (the viewed PR it draws
 * whatever its state). A click on either saves its setting and leaves the menu open, as GitHub's checkbox menus and
 * Graphite's do.
 */
export function StackMenu({
  showMerged,
  showClosed,
  onSettingsChange,
}: {
  showMerged: boolean;
  showClosed: boolean;
  /** Saves the setting Show merged PRs or Show closed PRs changed. */
  onSettingsChange: (patch: Pick<Partial<Settings>, 'stackShowMerged' | 'stackShowClosed'>) => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="pr-menu stack-menu" ref={menu}>
      <Button
        variant="ghost"
        size="sm"
        icon="kebab-horizontal"
        aria-label="Stack options"
        title="Stack options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      {open && (
        <div className="pr-menu-list" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              // Only the extension has an options page; in the standalone harness this is a no-op.
              if (browser?.runtime?.id) void browser.runtime.openOptionsPage();
            }}
          >
            <Icon name="gear" size={14} />
            View settings
          </button>
          <button role="menuitemcheckbox" aria-checked={showMerged} onClick={() => onSettingsChange({ stackShowMerged: !showMerged })}>
            <span className="pr-menu-check">{showMerged && <Icon name="check" size={14} />}</span>
            Show merged PRs
          </button>
          <button role="menuitemcheckbox" aria-checked={showClosed} onClick={() => onSettingsChange({ stackShowClosed: !showClosed })}>
            <span className="pr-menu-check">{showClosed && <Icon name="check" size={14} />}</span>
            Show closed PRs
          </button>
        </div>
      )}
    </div>
  );
}
