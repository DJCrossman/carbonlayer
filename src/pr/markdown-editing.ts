// What each command of the comment box does to its text and selection, the way GitHub's comment box does it. The
// toolbar's styles are GitHub's markdown-toolbar-element (MIT, github.com/github/markdown-toolbar-element, the copy
// GitHub's PR page loads), a URL pasted over text is GitHub's paste-markdown, a suggestion is what its "Add a
// suggestion" button inserts, and an emoji after a `:` is what its emoji suggestions offer and insert. Pure: a draft in,
// the draft after the command out.

import type { Emoji } from '../lib/model';

/** A comment box's text and its selection (start === end: only the caret), as a textarea has them. */
export interface Draft {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** `### ` before the word at the caret, or the selection; off again when the selection already starts with it. */
export function insertHeading(draft: Draft): Draft {
  return restyle(draft, { prefix: '### ' });
}

export function toggleBold(draft: Draft): Draft {
  return restyle(draft, { prefix: '**', suffix: '**', trimFirst: true });
}

export function toggleItalic(draft: Draft): Draft {
  return restyle(draft, { prefix: '_', suffix: '_', trimFirst: true });
}

/** `> ` before every selected line, set apart from the text around it by a blank line. */
export function toggleQuote(draft: Draft): Draft {
  return restyle(draft, { prefix: '> ', multiline: true, surroundWithNewlines: true });
}

/** Backticks around the selection, or a fenced block around several lines. */
export function toggleCode(draft: Draft): Draft {
  return restyle(draft, { prefix: '`', suffix: '`', blockPrefix: '```', blockSuffix: '```' });
}

/**
 * `[text](url)` with `url` selected, to be typed over; `[](url)` with the caret between the brackets when nothing is
 * selected; a selected URL becomes the link's target.
 */
export function insertLink(draft: Draft): Draft {
  return restyle(draft, { prefix: '[', suffix: '](url)', replaceNext: 'url', scanFor: 'https?://' });
}

/** Numbers every selected line `1.`, `2.`, …; off again when they all are; a bulleted list becomes numbered. */
export function toggleNumberedList(draft: Draft): Draft {
  return restyle(draft, { prefix: '1. ', multiline: true, orderedList: true });
}

/** `- ` before every selected line; off again when they all have it; a numbered list loses its numbers. */
export function toggleUnorderedList(draft: Draft): Draft {
  return restyle(draft, { prefix: '- ', multiline: true, unorderedList: true });
}

export function toggleTaskList(draft: Draft): Draft {
  return restyle(draft, { prefix: '- [ ] ', multiline: true, surroundWithNewlines: true });
}

/** A ```suggestion block holding `lines`, after whatever the comment says, the caret at the end of the lines. */
export function insertSuggestion(draft: Draft, lines: string): Draft {
  const block = `\`\`\`suggestion\n${lines}\n\`\`\``;
  const value = draft.value === '' ? block : `${draft.value}\n${block}`;
  const caret = value.length - '\n```'.length;
  return { value, selectionStart: caret, selectionEnd: caret };
}

/**
 * Enter in a list item: a new item below with the same marker (the next number, an unchecked box), the rest of the line
 * moving into it. On an item with nothing in it, Enter ends the list instead: the marker goes. Null where Enter is only
 * a line break: outside a list, before the marker, or with text selected.
 */
export function continueList(draft: Draft): Draft | null {
  const { value, selectionStart: caret } = draft;
  if (caret !== draft.selectionEnd) return null;
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const item = /^(\s*)([*-]|(\d+)\.)\s(?:(\[[\sx]\])\s)?/i.exec(value.slice(lineStart, caret));
  if (!item) return null;
  const lineEnd = value.indexOf('\n', caret) === -1 ? value.length : value.indexOf('\n', caret);
  if (value.slice(lineStart, lineEnd).trim() === item[0].trim()) {
    return { value: value.slice(0, lineStart) + value.slice(lineEnd), selectionStart: lineStart, selectionEnd: lineStart };
  }
  const [, indent, bullet, number, taskBox] = item;
  const marker = `\n${indent}${number ? `${Number(number) + 1}.` : bullet} ${taskBox ? '[ ] ' : ''}`;
  return { value: value.slice(0, caret) + marker + value.slice(caret), selectionStart: caret + marker.length, selectionEnd: caret + marker.length };
}

/**
 * A URL pasted over selected text links that text: `[text](url)`, the caret after it. Null where the paste is only a
 * paste: nothing selected, not a URL, a URL selected (it is being replaced), or inside a link's `](…)`.
 */
export function linkPastedUrl(draft: Draft, pasted: string): Draft | null {
  const { value, selectionStart, selectionEnd } = draft;
  const selected = value.slice(selectionStart, selectionEnd);
  if (!/^https?:\/\//i.test(pasted) || selected === '' || /^https?:\/\//i.test(selected.trim())) return null;
  if (value.slice(Math.max(0, selectionStart - 2), selectionStart) === '](') return null;
  const link = `[${selected}](${pasted.trim()})`;
  return { value: value.slice(0, selectionStart) + link + value.slice(selectionEnd), selectionStart: selectionStart + link.length, selectionEnd: selectionStart + link.length };
}

/**
 * The emoji the text asks for at the caret, as GitHub's comment box reads it (Primer's InlineAutocomplete, with `:` as
 * its trigger): a `:` at the start of the text or after whitespace, then what was typed after it up to the caret, with
 * no whitespace in it (`query`, empty right after the `:`); `at` is where the `:` is. Null with text selected, and where
 * no such `:` comes before the caret: one inside a word (`a:b`), or a space typed since.
 */
export function emojiQueryAt({ value, selectionStart, selectionEnd }: Draft): { at: number; query: string } | null {
  if (selectionStart !== selectionEnd) return null;
  const query = /(?:^|\s):(\S*)$/.exec(value.slice(0, selectionStart))?.[1];
  return query === undefined ? null : { at: selectionStart - query.length - 1, query };
}

/**
 * The five emoji GitHub's comment box suggests for `query`, the way it ranks them: those whose name has it, case aside,
 * the ones whose name begins with it first, and among equals `+1`, `thumbsup` and `-1` before the rest, else in the
 * list's order; of those five, `+1`, `thumbsup` and `-1` first. With nothing typed after the `:`, the list's first five.
 */
export function emojiSuggestionsFor(query: string, emojis: Emoji[]): Emoji[] {
  if (query === '') return emojis.slice(0, 5);
  const typed = query.toLowerCase();
  const preferred = (emoji: Emoji) => (['+1', 'thumbsup', '-1'].includes(emoji.name) ? 0 : 1);
  return emojis
    .map((emoji) => {
      const name = emoji.name.toLowerCase();
      return { emoji, score: (name.includes(typed) ? 5 : 0) + (name.startsWith(typed) ? 5 : 0) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || preferred(a.emoji) - preferred(b.emoji))
    .slice(0, 5)
    .map(({ emoji }) => emoji)
    .sort((a, b) => preferred(a) - preferred(b));
}

/**
 * The `:` and what was typed after it (emojiQueryAt) replaced by the emoji chosen for it and a space, the caret after the
 * space, as GitHub's comment box commits a suggestion: one of Unicode's as its character, one of GitHub's own as
 * `:name:`, which GitHub shows as its image. Null where the text asks for no emoji at the caret.
 */
export function insertEmoji(draft: Draft, emoji: Emoji): Draft | null {
  const asked = emojiQueryAt(draft);
  if (!asked) return null;
  const typed = `${'character' in emoji ? emoji.character : `:${emoji.name}:`} `;
  const caret = asked.at + typed.length;
  return { value: draft.value.slice(0, asked.at) + typed + draft.value.slice(draft.selectionEnd), selectionStart: caret, selectionEnd: caret };
}

/** One of markdown-toolbar-element's styles. */
interface ToolbarStyle {
  prefix: string;
  suffix?: string;
  /** Used instead of prefix and suffix around several lines. */
  blockPrefix?: string;
  blockSuffix?: string;
  multiline?: boolean;
  /** The placeholder in the suffix that the selection fills, or that is selected for typing over. */
  replaceNext?: string;
  /** A selection that matches this fills the placeholder. */
  scanFor?: string;
  surroundWithNewlines?: boolean;
  orderedList?: boolean;
  unorderedList?: boolean;
  /** Whitespace at the edges of the selection stays outside the markers. */
  trimFirst?: boolean;
}

/** What replaces the (widened) selection, and the selection afterwards. */
interface Replacement {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * A toolbar style applied as markdown-toolbar-element applies it: the selection is widened first (to the word at the
 * caret, to markers already around it, to whole lines for a list), then replaced.
 */
function restyle(draft: Draft, style: ToolbarStyle): Draft {
  const field: Draft = { value: draft.value, selectionStart: draft.selectionStart, selectionEnd: draft.selectionEnd };
  const severalLines = field.value.slice(field.selectionStart, field.selectionEnd).trim().includes('\n');
  const replacement =
    style.orderedList || style.unorderedList
      ? toggleListItems(field, !!style.unorderedList)
      : style.multiline && severalLines
        ? prefixEachLine(field, style)
        : wrapSelection(field, style);
  return {
    value: field.value.slice(0, field.selectionStart) + replacement.text + field.value.slice(field.selectionEnd),
    selectionStart: replacement.selectionStart,
    selectionEnd: replacement.selectionEnd,
  };
}

/** Lines become list items, numbered or bulleted; off again when every line already is one of that kind. */
function toggleListItems(field: Draft, unordered: boolean): Replacement {
  const caretOnly = field.selectionStart === field.selectionEnd;
  const caret = field.selectionStart;
  let lineStart = 0;
  for (const line of field.value.split('\n')) {
    const lineEnd = lineStart + line.length;
    if (field.selectionStart >= lineStart && field.selectionStart <= lineEnd) field.selectionStart = lineStart;
    if (field.selectionEnd >= lineStart && field.selectionEnd <= lineEnd) field.selectionEnd = lineEnd;
    lineStart = lineEnd + 1;
  }
  const lines = field.value.slice(field.selectionStart, field.selectionEnd);
  const asked = withoutListMarkers(lines, unordered ? 'unordered' : 'ordered');
  const other = withoutListMarkers(asked.text, unordered ? 'ordered' : 'unordered');
  const marker = (index: number, bulleted: boolean) => (bulleted ? '- ' : `${index + 1}. `);
  const items = other.text.split('\n').map((line, index) => marker(index, unordered) + line);
  const markersLength = items.reduce((sum, _, index) => sum + marker(index, unordered).length, 0);
  if (asked.processed) {
    if (!caretOnly) return { text: other.text, selectionStart: field.selectionStart, selectionEnd: field.selectionEnd - markersLength };
    const moved = Math.max(caret - marker(0, unordered).length, 0);
    return { text: other.text, selectionStart: moved, selectionEnd: moved };
  }
  const breaks = paragraphBreaks(field);
  const text = breaks.before + items.join('\n') + breaks.after;
  if (caretOnly) {
    const moved = caret + marker(0, unordered).length + breaks.before.length;
    return { text, selectionStart: moved, selectionEnd: moved };
  }
  const otherMarkersLength = other.processed ? items.reduce((sum, _, index) => sum + marker(index, !unordered).length, 0) : 0;
  return { text, selectionStart: field.selectionStart + breaks.before.length, selectionEnd: field.selectionEnd + breaks.before.length + markersLength - otherMarkersLength };
}

/** The lines without their list markers when every line has one of this kind; `processed` says whether they did. */
function withoutListMarkers(lines: string, kind: 'ordered' | 'unordered'): { text: string; processed: boolean } {
  const split = lines.split('\n');
  const marked = split.every((line) => (kind === 'ordered' ? /^\d+\.\s+/.test(line) : line.startsWith('- ')));
  if (!marked) return { text: lines, processed: false };
  return { text: split.map((line) => (kind === 'ordered' ? line.replace(/^\d+\.\s+/, '') : line.slice(2))).join('\n'), processed: true };
}

/** The style's prefix and suffix on every selected line; off again when every line has them. */
function prefixEachLine(field: Draft, { prefix, suffix = '', surroundWithNewlines }: ToolbarStyle): Replacement {
  const lines = field.value.slice(field.selectionStart, field.selectionEnd).split('\n');
  if (lines.every((line) => line.startsWith(prefix) && line.endsWith(suffix))) {
    const text = lines.map((line) => line.slice(prefix.length, line.length - suffix.length)).join('\n');
    return { text, selectionStart: field.selectionStart, selectionEnd: field.selectionStart + text.length };
  }
  const text = lines.map((line) => prefix + line + suffix).join('\n');
  if (!surroundWithNewlines) return { text, selectionStart: field.selectionStart, selectionEnd: field.selectionEnd };
  const breaks = paragraphBreaks(field);
  const start = field.selectionStart + breaks.before.length;
  return { text: breaks.before + text + breaks.after, selectionStart: start, selectionEnd: start + text.length };
}

/** The style's prefix and suffix around the selection; off again when they are already there. */
function wrapSelection(field: Draft, style: ToolbarStyle): Replacement {
  const { prefix, suffix = '', blockPrefix = '', blockSuffix = '', replaceNext = '', scanFor = '' } = style;
  const originalStart = field.selectionStart;
  const originalEnd = field.selectionEnd;
  const severalLines = field.value.slice(originalStart, originalEnd).trim().includes('\n');
  let prefixToUse = severalLines && blockPrefix ? `${blockPrefix}\n` : prefix;
  let suffixToUse = severalLines && blockSuffix ? `\n${blockSuffix}` : suffix;
  const selected = widenSelection(field, prefixToUse, suffixToUse, !!style.multiline);
  const { selectionStart, selectionEnd } = field;
  const fillsPlaceholder = replaceNext !== '' && suffixToUse.includes(replaceNext) && selected !== '';
  if (style.surroundWithNewlines) {
    const breaks = paragraphBreaks(field);
    prefixToUse = breaks.before + prefix;
    suffixToUse += breaks.after;
  }

  if (selected.startsWith(prefixToUse) && selected.endsWith(suffixToUse)) {
    const text = selected.slice(prefixToUse.length, selected.length - suffixToUse.length);
    if (originalStart !== originalEnd) return { text, selectionStart, selectionEnd: selectionStart + text.length };
    const caret = Math.min(Math.max(originalStart - prefixToUse.length, selectionStart), selectionStart + text.length);
    return { text, selectionStart: caret, selectionEnd: caret };
  }
  if (!fillsPlaceholder) {
    const edges = selected.match(/^\s*|\s*$/g);
    if (!style.trimFirst || !edges) {
      return { text: prefixToUse + selected + suffixToUse, selectionStart: originalStart + prefixToUse.length, selectionEnd: originalEnd + prefixToUse.length };
    }
    const leading = edges[0] ?? '';
    const trailing = edges[1] ?? '';
    return {
      text: leading + prefixToUse + selected.trim() + suffixToUse + trailing,
      selectionStart: originalStart + prefixToUse.length + leading.length,
      selectionEnd: originalEnd + prefixToUse.length - trailing.length,
    };
  }
  if (scanFor !== '' && new RegExp(scanFor).test(selected)) {
    const caret = selectionStart + prefixToUse.length;
    return { text: prefixToUse + suffixToUse.replace(replaceNext, selected), selectionStart: caret, selectionEnd: caret };
  }
  const placeholder = selectionStart + prefixToUse.length + selected.length + suffixToUse.indexOf(replaceNext);
  return { text: prefixToUse + selected + suffixToUse, selectionStart: placeholder, selectionEnd: placeholder + replaceNext.length };
}

/**
 * Widens `field`'s selection as the toolbar does before styling it, and answers the text it then covers: a bare caret
 * takes in the word around it (up to the end of the line for a multiline style; at the very end of the text it stays a
 * caret), and a selection takes in the prefix and suffix right around it when both are there.
 */
function widenSelection(field: Draft, prefix: string, suffix: string, multiline: boolean): string {
  const { value } = field;
  if (field.selectionStart === field.selectionEnd) {
    let start = field.selectionStart;
    while (value[start] !== undefined && start > 0 && !/\s/.test(value.charAt(start - 1))) start--;
    let end = field.selectionEnd;
    while (value[end] !== undefined && !(multiline ? /\n/ : /\s/).test(value.charAt(end))) end++;
    field.selectionStart = start;
    field.selectionEnd = end;
  } else if (
    field.selectionStart >= prefix.length &&
    value.slice(field.selectionStart - prefix.length, field.selectionStart) === prefix &&
    value.slice(field.selectionEnd, field.selectionEnd + suffix.length) === suffix
  ) {
    field.selectionStart -= prefix.length;
    field.selectionEnd += suffix.length;
  }
  return value.slice(field.selectionStart, field.selectionEnd);
}

/** The line breaks that set the selection apart as a paragraph of its own: up to a blank line on each side of it. */
function paragraphBreaks(field: Draft): { before: string; after: string } {
  const before = field.value.slice(0, field.selectionStart);
  const after = field.value.slice(field.selectionEnd);
  const breaksBefore = before.length - before.replace(/\n+$/, '').length;
  const breaksAfter = after.length - after.replace(/^\n+/, '').length;
  return {
    before: /\S/.test(before) && breaksBefore < 2 ? '\n'.repeat(2 - breaksBefore) : '',
    after: /\S/.test(after) && breaksAfter < 2 ? '\n'.repeat(2 - breaksAfter) : '',
  };
}
