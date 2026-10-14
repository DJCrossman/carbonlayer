// Graphite's PR-page keybindings, with Linear's copy shortcuts (src/app/copy-pull-request.ts): the document-level
// listener, the binding table (also rendered by the help overlay and the legend), and a chord reader that understands
// sequences like "r c".
// The parent github.com page replays its own keystrokes into this document (entrypoints/app/main.tsx),
// so one `keydown` listener on `document` sees both.

import { useEffect, useRef } from 'react';
import { COPY_KEYBINDINGS, type CopyAction } from '../app/copy-pull-request';

/** Runs `onAction` for every PR keybinding pressed outside a text field. */
export function usePrKeybindings(onAction: (action: PrAction) => void): void {
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  useEffect(() => {
    const read = createChordReader(PR_KEYBINDINGS, { isMac: navigator.userAgent.includes('Mac') });
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)))
      ) {
        return;
      }
      const result = read(event);
      if (result === null) return;
      // ⌘C copies the PR only while no text is selected; otherwise it is the browser's copy. A selection in a diff's shadow
      // root reads as collapsed from here, but its type is still Range.
      if (result !== 'pending' && result.action === 'copy-title-link' && document.getSelection()?.type === 'Range') return;
      event.preventDefault();
      if (result !== 'pending') onActionRef.current(result.action);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** `mod` is ⌘ on macOS and Ctrl elsewhere; space separates the strokes of a chord. */
export const PR_KEYBINDINGS: ReadonlyArray<{ chord: string; action: PrAction; label: string; legend?: boolean }> = [
  { chord: 'j', action: 'next-file', label: 'Next file', legend: true },
  { chord: 'k', action: 'prev-file', label: 'Previous file', legend: true },
  { chord: 'n', action: 'next-thread', label: 'Next unresolved thread', legend: true },
  { chord: 'p', action: 'prev-thread', label: 'Previous unresolved thread' },
  { chord: 'v', action: 'toggle-viewed', label: 'Mark current file viewed', legend: true },
  { chord: 'e', action: 'toggle-file', label: 'Expand / collapse current file' },
  { chord: 'f', action: 'toggle-tree', label: 'Toggle file tree', legend: true },
  { chord: 's', action: 'toggle-stack', label: 'Toggle stack', legend: true },
  // Graphite's old threads panel was c, which starts c r here (and would wait for it); shift keeps its letter.
  { chord: 'C', action: 'toggle-comments', label: 'Toggle comments' },
  { chord: 'mod+shift+ArrowDown', action: 'stack-down', label: 'Down the stack' },
  { chord: 'mod+shift+ArrowUp', action: 'stack-up', label: 'Up the stack' },
  { chord: 'r c', action: 'review-comment', label: 'Review: comment', legend: true },
  { chord: 'r n', action: 'review-request-changes', label: 'Review: request changes' },
  { chord: 'r a', action: 'review-approve', label: 'Review: approve' },
  { chord: 'r y', action: 'quick-approve', label: 'Quick approve', legend: true },
  // Graphite's old "e r" would shadow e (expand / collapse file): a single key that starts a chord waits for the next one.
  { chord: 'r e', action: 'edit-reviewers', label: 'Edit reviewers' },
  { chord: 'c r', action: 'rerun-failed-checks', label: 'Re-run failed checks' },
  { chord: 'g d', action: 'go-description', label: 'Go to description' },
  { chord: 'g f', action: 'go-files', label: 'Go to files' },
  { chord: 'g h', action: 'open-github', label: 'Open on GitHub' },
  ...COPY_KEYBINDINGS,
  { chord: '?', action: 'help', label: 'Show all shortcuts', legend: true },
  { chord: 'Escape', action: 'close', label: 'Close overlay' },
];

/**
 * Turns a stream of keydown events into actions. A stroke that starts a longer chord ("r") returns
 * 'pending'; the chord completes if the next stroke arrives within `timeoutMs`. A stroke that does
 * not continue the pending chord is read afresh. Modifier-only presses are ignored.
 */
export function createChordReader<A>(
  bindings: ReadonlyArray<{ chord: string; action: A }>,
  { isMac, timeoutMs = 1500 }: { isMac: boolean; timeoutMs?: number },
): (event: KeyEventLike) => { action: A } | 'pending' | null {
  const parsed = bindings.map((binding) => ({ strokes: parseChord(binding.chord), action: binding.action }));
  let pending: { candidates: typeof parsed; depth: number; at: number } | null = null;

  return (event) => {
    if (event.key === 'Shift' || event.key === 'Meta' || event.key === 'Control' || event.key === 'Alt') return null;
    if (pending && event.timeStamp - pending.at <= timeoutMs) {
      const { depth } = pending;
      const candidates = pending.candidates.filter((candidate) => matches(candidate.strokes[depth], event));
      pending = null;
      if (candidates.length > 0) return advance(candidates, depth + 1, event.timeStamp);
    }
    pending = null;
    const candidates = parsed.filter((candidate) => matches(candidate.strokes[0], event));
    return candidates.length > 0 ? advance(candidates, 1, event.timeStamp) : null;
  };

  function advance(candidates: typeof parsed, depth: number, at: number): { action: A } | 'pending' {
    const complete = candidates.find((candidate) => candidate.strokes.length === depth);
    const longer = candidates.filter((candidate) => candidate.strokes.length > depth);
    if (complete && longer.length === 0) return { action: complete.action };
    pending = { candidates: longer, depth, at };
    return 'pending';
  }

  function matches(stroke: KeyStroke | undefined, event: KeyEventLike): boolean {
    if (!stroke) return false;
    const mod = isMac ? event.metaKey : event.ctrlKey;
    const otherMod = isMac ? event.ctrlKey : event.metaKey;
    if (stroke.mod !== mod || otherMod || stroke.alt !== event.altKey) return false;
    // A printable key already carries its shift state ("?" is shift+/), so shift only matters for
    // named keys such as ArrowDown, and beside ⌘ / Ctrl, where the key may not show it (macOS can report
    // ⌘⇧C as "c"): ⌘C must not take DevTools' ⌘⇧C.
    if (stroke.key.length === 1 && !stroke.mod) return event.key === stroke.key;
    return event.key === stroke.key && stroke.shift === event.shiftKey;
  }
}

/** Parses "r c", "mod+shift+ArrowDown" or "?" into its strokes. */
export function parseChord(spec: string): KeyStroke[] {
  return spec
    .trim()
    .split(/\s+/)
    .map((stroke) => {
      // "+" on its own is a key, so split on "+" only between parts ("mod++" is mod and "+").
      const parts = stroke.length > 1 ? stroke.split(/\+(?=.)/) : [stroke];
      const key = parts.pop() ?? '';
      const modifiers = new Set(parts.map((part) => part.toLowerCase()));
      return { key, mod: modifiers.has('mod'), shift: modifiers.has('shift'), alt: modifiers.has('alt') };
    });
}

type PrAction =
  | 'next-file'
  | 'prev-file'
  | 'next-thread'
  | 'prev-thread'
  | 'toggle-tree'
  | 'toggle-stack'
  | 'toggle-comments'
  | 'stack-down'
  | 'stack-up'
  | 'review-comment'
  | 'review-request-changes'
  | 'review-approve'
  | 'quick-approve'
  | 'edit-reviewers'
  | 'rerun-failed-checks'
  | 'toggle-viewed'
  | 'toggle-file'
  | 'open-github'
  | 'go-description'
  | 'go-files'
  | CopyAction
  | 'help'
  | 'close';

interface KeyStroke {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'timeStamp'>;
