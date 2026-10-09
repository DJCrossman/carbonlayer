// Pure diff logic for the Files section: what the diff library can render for a changed file, which
// notes (review threads, batched comments, the open composer) sit on which of its lines, and the file
// tree that orders the files.

import { parsePatchFiles, type DiffLineAnnotation, type FileDiffMetadata } from '@pierre/diffs';
import type { ReviewThreadDraft } from '../app/data-source';
import type { ChangedFile, ReviewThread } from '../lib/model';

/** What an annotation in the diff carries. */
export type DiffNote =
  | { kind: 'thread'; thread: ReviewThread }
  | { kind: 'pending'; draft: ReviewThreadDraft; index: number }
  | { kind: 'composer' };

/** Where the inline comment composer is open: a line on one side of one file. */
export interface ComposerAnchor {
  path: string;
  line: number;
  side: 'deletions' | 'additions';
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

export type FileTreeNode =
  | { kind: 'dir'; name: string; path: string; children: FileTreeNode[] }
  | { kind: 'file'; name: string; file: ChangedFile };

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
