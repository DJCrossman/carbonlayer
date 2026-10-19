// Pure diff logic for the Files section: what the diff library can render for a changed file, which
// notes (review threads, batched comments, the open composer) sit on which of its lines, where the
// composer opens for selected lines, the rows a comment sits on (for the comments drawer), the file
// tree that orders the files, and the unchanged lines a diff leaves out, which expanding it shows.

import { parsePatchFiles, type DiffLineAnnotation, type FileDiffMetadata, type SelectedLineRange } from '@pierre/diffs';
import type { ReviewThreadDraft } from '../app/data-source';
import type { ChangedFile, ReviewThread } from '../lib/model';
import type { DiffEntryLine, LineRange } from '../lib/rpc';

/** What an annotation in the diff carries. */
export type DiffNote =
  | { kind: 'thread'; thread: ReviewThread }
  | { kind: 'pending'; draft: ReviewThreadDraft; index: number }
  | { kind: 'composer' };

/** Where the inline comment composer is open: under a line, or the last line of a range, on one side of one file. */
export interface ComposerAnchor {
  path: string;
  line: number;
  side: 'deletions' | 'additions';
  /** A range's first line, possibly on the other side; both absent for one line. */
  startLine?: number;
  startSide?: 'deletions' | 'additions';
}

/**
 * The diff the library can render for a changed file, or null when GitHub sent no patch (binary or
 * too large). GitHub's `patch` is hunks only; the parser needs a git file header to find the file,
 * its name and its change type, so one is built from the file's path, previous path and status.
 */
export function renderableDiff(file: ChangedFile): FileDiffMetadata | null {
  if (file.patch === null) return null;
  const oldPath = file.previousPath ?? file.path;
  const header = [`diff --git a/${oldPath} b/${file.path}`];
  if (file.status === 'added') {
    header.push('new file mode 100644', '--- /dev/null', `+++ b/${file.path}`);
  } else if (file.status === 'removed') {
    header.push('deleted file mode 100644', `--- a/${oldPath}`, '+++ /dev/null');
  } else {
    if (file.previousPath !== null && file.previousPath !== file.path) {
      // A rename without content changes comes with an empty patch; git calls that 100% similar.
      header.push(`similarity index ${file.patch.trim() === '' ? 100 : 50}%`, `rename from ${oldPath}`, `rename to ${file.path}`);
    }
    header.push(`--- a/${oldPath}`, `+++ b/${file.path}`);
  }
  return parsePatchFiles(`${header.join('\n')}\n${file.patch}\n`)[0]?.files[0] ?? null;
}

/**
 * The notes that sit on one file's diff: its review threads, the comments batched for the pending
 * review, and the open composer. GitHub's RIGHT side is the library's `additions`, LEFT is
 * `deletions`. A thread GitHub can no longer place (outdated, `line === null`) becomes a file-level
 * note (`lineNumber: 0`), which the library renders above the first hunk.
 */
export function fileNotes(
  path: string,
  threads: ReviewThread[],
  batch: ReviewThreadDraft[],
  composer: ComposerAnchor | null,
): DiffLineAnnotation<DiffNote>[] {
  const notes: DiffLineAnnotation<DiffNote>[] = [];
  for (const thread of threads) {
    if (thread.path !== path) continue;
    notes.push({ side: thread.side === 'LEFT' ? 'deletions' : 'additions', lineNumber: thread.line ?? 0, metadata: { kind: 'thread', thread } });
  }
  batch.forEach((draft, index) => {
    if (draft.path !== path) return;
    notes.push({ side: draft.side === 'LEFT' ? 'deletions' : 'additions', lineNumber: draft.line, metadata: { kind: 'pending', draft, index } });
  });
  if (composer?.path === path) notes.push({ side: composer.side, lineNumber: composer.line, metadata: { kind: 'composer' } });
  return notes;
}

/**
 * Where the composer opens for lines selected in a file's diff: under the range's last line, its first line as the
 * start. The library reports the line pressed first as `start`, so a selection dragged upwards comes reversed, and
 * GitHub wants the start first in its unified diff whatever the layout: a change block lists its deleted lines before
 * its added ones, so on different sides the line numbers alone cannot tell.
 */
export function composerAnchorFor(path: string, diff: FileDiffMetadata, range: SelectedLineRange): ComposerAnchor {
  const pressed = { line: range.start, side: range.side ?? 'additions' };
  const released = { line: range.end, side: range.endSide ?? pressed.side };
  const [first, last] = unifiedRow(pressed) <= unifiedRow(released) ? [pressed, released] : [released, pressed];
  if (first.line === last.line && first.side === last.side) return { path, line: last.line, side: last.side };
  return { path, line: last.line, side: last.side, startLine: first.line, startSide: first.side };

  // As the library places a line (FileDiff's getLineIndexForDiff): unchanged lines outside the hunks, shown once
  // expanded, are one row each on both sides.
  function unifiedRow({ line, side }: { line: number; side: 'deletions' | 'additions' }): number {
    let row = 0;
    let number = 1;
    for (const hunk of diff.hunks) {
      row = hunk.unifiedLineStart;
      number = side === 'deletions' ? hunk.deletionStart : hunk.additionStart;
      if (line < number) return row - (number - line);
      for (const content of hunk.hunkContent) {
        const lines = content.type === 'context' ? content.lines : side === 'deletions' ? content.deletions : content.additions;
        if (line < number + lines) return row + (content.type === 'change' && side === 'additions' ? content.deletions : 0) + (line - number);
        number += lines;
        row += content.type === 'context' ? content.lines : content.deletions + content.additions;
      }
    }
    return row + (line - number);
  }
}

export type FileTreeNode =
  | { kind: 'dir'; name: string; path: string; children: FileTreeNode[] }
  | { kind: 'file'; name: string; file: ChangedFile };

/**
 * The commented lines as they read now, which GitHub's "Add a suggestion" starts the suggestion from: the new file's
 * lines `from` to `to`, read from the patch. Null when the patch does not reach them (a suggestion replaces lines that
 * exist on the right side).
 */
export function currentLinesOf(patch: string, from: number, to: number): string | null {
  const lines: string[] = [];
  let next = 0;
  for (const row of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    // Context and added lines are the new file's; removed lines and "\ No newline at end of file" are not.
    if (next === 0 || row.startsWith('-') || row.startsWith('\\')) continue;
    if (next >= from && next <= to) lines.push(row.slice(1));
    next++;
  }
  return lines.length === to - from + 1 ? lines.join('\n') : null;
}

/**
 * The diff rows a comment sits on, as the patch shows them: from its first commented line to its last in the unified
 * diff's order, so a range over a change block keeps the removed lines among the added ones. Each row is numbered in its
 * own file (the old one for removed lines, the new one for added), an unchanged row in the file the comment's last line
 * is on. Null when the patch does not reach those lines in one hunk (an outdated thread).
 */
export function commentedRows(patch: string, first: DiffLineRef, last: DiffLineRef): CommentedRow[] | null {
  const rows: CommentedRow[] = [];
  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;
  for (const row of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (hunk) {
      // GitHub only takes a comment on lines of one hunk.
      if (rows.length > 0) return null;
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (!inHunk || row.startsWith('\\')) continue;
    const kind = row.startsWith('+') ? 'added' : row.startsWith('-') ? 'removed' : 'context';
    const isAt = ({ side, line }: DiffLineRef) => (side === 'LEFT' ? kind !== 'added' && oldLine === line : kind !== 'removed' && newLine === line);
    if (rows.length > 0 || isAt(first)) {
      rows.push({ kind, line: kind === 'removed' || (kind === 'context' && last.side === 'LEFT') ? oldLine : newLine, text: row.slice(1) });
      if (isAt(last)) return rows;
    }
    if (kind !== 'added') oldLine++;
    if (kind !== 'removed') newLine++;
  }
  return null;
}

/** A line on one side of a diff, the way GitHub names it: the old file's (LEFT) or the new file's (RIGHT). */
export interface DiffLineRef {
  side: 'LEFT' | 'RIGHT';
  line: number;
}

/** One row of a diff: the line's number in its own file, and its text without the diff's marker. */
export interface CommentedRow {
  kind: 'added' | 'removed' | 'context';
  line: number;
  text: string;
}

/**
 * The changed files as a directory tree, directories before files, each level sorted by name.
 * Chains of single-directory levels are merged ("src/parcs") the way GitHub's file tree shows them.
 */
export function fileTree(files: ChangedFile[]): FileTreeNode[] {
  const root: FileTreeNode & { kind: 'dir' } = { kind: 'dir', name: '', path: '', children: [] };
  for (const file of files) {
    const segments = file.path.split('/');
    const name = segments.pop() ?? file.path;
    let dir = root;
    for (const segment of segments) {
      const path = dir.path ? `${dir.path}/${segment}` : segment;
      let next = dir.children.find((child): child is FileTreeNode & { kind: 'dir' } => child.kind === 'dir' && child.name === segment);
      if (!next) {
        next = { kind: 'dir', name: segment, path, children: [] };
        dir.children.push(next);
      }
      dir = next;
    }
    dir.children.push({ kind: 'file', name, file });
  }
  return tidy(root.children);

  function tidy(nodes: FileTreeNode[]): FileTreeNode[] {
    return nodes
      .map((node) => {
        if (node.kind === 'file') return node;
        let merged = node;
        while (merged.children.length === 1 && merged.children[0]?.kind === 'dir') {
          const only = merged.children[0];
          merged = { kind: 'dir', name: `${merged.name}/${only.name}`, path: only.path, children: only.children };
        }
        return { ...merged, children: tidy(merged.children) };
      })
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  }
}

/** The files in the order the tree shows them, which is also the order the diffs are rendered in. */
export function filesInTreeOrder(tree: FileTreeNode[]): ChangedFile[] {
  return tree.flatMap((node) => (node.kind === 'file' ? [node.file] : filesInTreeOrder(node.children)));
}

/**
 * The new file's lines a diff of hunks leaves out, as ranges of their numbers: above its first hunk, between its hunks,
 * and after its last. What expanding the diff's unchanged lines asks GitHub for, every range at once, since the diff
 * library expands lines only once it has the whole file (`loadDiffFiles`). The diff does not say where the file ends: the
 * last range runs 10,000 lines on, and GitHub's answer stops at the end of the file (assumed, unverified).
 */
export function hiddenLines(diff: FileDiffMetadata): LineRange[] {
  const ranges: LineRange[] = [];
  let next = 1;
  for (const hunk of diff.hunks) {
    // A hunk that adds no line names the line before it (`+12,0`).
    const first = hunk.additionCount === 0 ? hunk.additionStart + 1 : hunk.additionStart;
    if (first > next) ranges.push({ start: next, end: first - 1 });
    next = first + hunk.additionCount;
  }
  ranges.push({ start: next, end: next + 9_999 });
  return ranges;
}

/**
 * The whole file on both sides, from GitHub's answer for every line its diff leaves out (`hiddenLines`): the old file is
 * the unchanged and removed lines by their numbers in it (`left`), the new file the unchanged and added ones by theirs
 * (`right`), each without its diff marker, and a side ends without a newline where GitHub warns of none. Throws when a
 * side misses a line, which an answer that stopped short of a range before the end of the file would leave.
 */
export function fileContentsFrom(lines: DiffEntryLine[]): { old: string; new: string } {
  const old = new Map<number, DiffEntryLine>();
  const next = new Map<number, DiffEntryLine>();
  for (const line of lines) {
    if (line.type === 'CONTEXT' || line.type === 'DELETION') old.set(line.left, line);
    if (line.type === 'CONTEXT' || line.type === 'ADDITION') next.set(line.right, line);
  }
  return { old: contentsOf('old', old), new: contentsOf('new', next) };

  function contentsOf(side: 'old' | 'new', numbered: Map<number, DiffEntryLine>): string {
    if (numbered.size === 0) return '';
    const texts: string[] = [];
    for (let number = 1; number <= numbered.size; number++) {
      const line = numbered.get(number);
      if (!line) throw new Error(`GitHub's answer has no line ${number} of the ${side} file`);
      const marker = line.type === 'CONTEXT' ? ' ' : line.type === 'DELETION' ? '-' : '+';
      texts.push(line.text.startsWith(marker) ? line.text.slice(1) : line.text);
    }
    return `${texts.join('\n')}${numbered.get(numbered.size)?.displayNoNewLineWarning ? '' : '\n'}`;
  }
}

/**
 * Whether GitHub takes a comment on the selected lines: both ends on lines of the diff's hunks. Whether it takes one on
 * the unchanged lines expanded around them is not known (its own diff offers none there), so they take none.
 */
export function takesComments(diff: FileDiffMetadata, range: SelectedLineRange): boolean {
  const side = range.side ?? 'additions';
  return [
    { line: range.start, side },
    { line: range.end, side: range.endSide ?? side },
  ].every(({ line, side }) =>
    diff.hunks.some((hunk) =>
      side === 'deletions'
        ? line >= hunk.deletionStart && line < hunk.deletionStart + hunk.deletionCount
        : line >= hunk.additionStart && line < hunk.additionStart + hunk.additionCount,
    ),
  );
}
