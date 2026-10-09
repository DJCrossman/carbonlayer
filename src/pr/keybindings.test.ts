import { describe, expect, it } from 'vitest';
import { createChordReader, parseChord, PR_KEYBINDINGS } from './keybindings';

const key = (key: string, at: number, modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key,
  timeStamp: at,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe('parseChord', () => {
  it('splits a chord into strokes and a stroke into modifiers and key', () => {
    expect(parseChord('r c')).toEqual([
      { key: 'r', mod: false, shift: false, alt: false },
      { key: 'c', mod: false, shift: false, alt: false },
    ]);
    expect(parseChord('mod+shift+ArrowDown')).toEqual([{ key: 'ArrowDown', mod: true, shift: true, alt: false }]);
  });

  it('reads "?" and "+" as keys, not separators', () => {
    expect(parseChord('?')).toEqual([{ key: '?', mod: false, shift: false, alt: false }]);
    expect(parseChord('mod++')).toEqual([{ key: '+', mod: true, shift: false, alt: false }]);
  });
});

describe('createChordReader', () => {
  const mac = () => createChordReader(PR_KEYBINDINGS, { isMac: true, timeoutMs: 1000 });

  it('runs single keys straight away', () => {
    const read = mac();
    expect(read(key('j', 0))).toEqual({ action: 'next-file' });
    expect(read(key('?', 10, { shiftKey: true }))).toEqual({ action: 'help' });
  });

  it('waits for the second stroke of a chord', () => {
    const read = mac();
    expect(read(key('r', 0))).toBe('pending');
    expect(read(key('y', 300))).toEqual({ action: 'quick-approve' });
    expect(read(key('g', 400))).toBe('pending');
    expect(read(key('h', 500))).toEqual({ action: 'open-github' });
  });

  it('forgets a chord after the timeout and reads the late key afresh', () => {
    const read = mac();
    expect(read(key('r', 0))).toBe('pending');
    expect(read(key('j', 2000))).toEqual({ action: 'next-file' });
  });

  it('reads a key that does not continue the chord on its own', () => {
    const read = mac();
    expect(read(key('g', 0))).toBe('pending');
    expect(read(key('j', 100))).toEqual({ action: 'next-file' });
    expect(read(key('x', 200))).toBeNull();
  });

  it('ignores modifier presses in the middle of a chord', () => {
    const read = mac();
    expect(read(key('r', 0))).toBe('pending');
    expect(read(key('Shift', 100, { shiftKey: true }))).toBeNull();
    expect(read(key('a', 200))).toEqual({ action: 'review-approve' });
  });

  it('maps mod to ⌘ on macOS and Ctrl elsewhere, and requires shift for named keys', () => {
    expect(mac()(key('ArrowDown', 0, { metaKey: true, shiftKey: true }))).toEqual({ action: 'stack-down' });
    expect(mac()(key('ArrowDown', 0, { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(mac()(key('ArrowDown', 0, { metaKey: true }))).toBeNull();
    const other = createChordReader(PR_KEYBINDINGS, { isMac: false });
    expect(other(key('ArrowUp', 0, { ctrlKey: true, shiftKey: true }))).toEqual({ action: 'stack-up' });
  });

  it('leaves browser shortcuts alone', () => {
    expect(mac()(key('r', 0, { metaKey: true }))).toBeNull();
    expect(mac()(key('f', 0, { ctrlKey: true }))).toBeNull();
  });
});
