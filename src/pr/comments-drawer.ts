// What the PR page's comments drawer lists, as Graphite's: the review threads and the comments batched for the pending
// review, narrowed to one reviewer and one status, sorted by where they sit in the diff or by how recent they are,
// each with the code it sits on. The drawer (CommentsDrawer.tsx) only renders what this picks.
import type { ReviewThreadDraft } from '../app/data-source';
import type { ChangedFile, ReviewThread, UserRef } from '../lib/model';
import { commentedRows, type CommentedRow, type DiffLineRef } from './diff';

/**
 * The drawer's conversations for its filters, and what the filters themselves offer: how many each status would show
 * for the reviewer chosen, and everyone who started or commented in a thread. `files` come in the order the diff shows
 * them; the comments batched for the review are the viewer's own.
 */
export function drawerContents(
  threads: ReviewThread[],
  batch: ReviewThreadDraft[],
  files: ChangedFile[],
  filters: DrawerFilters,
  viewerLogin: string,
): {
  shown: DrawerEntry[];
  /** Threads and batched comments the filters leave out. */
  hidden: number;
  counts: Record<'open' | 'resolved' | 'pending', number>;
  reviewers: UserRef[];
} {
  const reviewer = filters.reviewer?.toLowerCase() ?? null;
  const reviewersThreads = threads.filter((thread) => reviewer === null || thread.comments.some((comment) => comment.author.login.toLowerCase() === reviewer));
  const reviewersBatch = reviewer === null || reviewer === viewerLogin.toLowerCase() ? batch : [];
  const { status } = filters;

  const shown: DrawerEntry[] = [
    ...reviewersThreads
      .filter((thread) => status === 'all' || (status !== 'pending' && thread.isResolved === (status === 'resolved')))
      .map((thread) => {
        const lines = thread.line === null ? null : { first: { side: thread.side, line: thread.startLine ?? thread.line }, last: { side: thread.side, line: thread.line } };
        return { kind: 'thread' as const, thread, path: thread.path, lines, code: codeAt(thread.path, lines) };
      }),
    // The batch itself or nothing, so a draft's position here is its index in the batch.
    ...(status === 'all' || status === 'pending' ? reviewersBatch : []).map((draft, index) => {
      const lines = { first: { side: draft.startSide ?? draft.side, line: draft.startLine ?? draft.line }, last: { side: draft.side, line: draft.line } };
      return { kind: 'pending' as const, draft, index, path: draft.path, lines, code: codeAt(draft.path, lines) };
    }),
  ];

  if (filters.order === 'file') {
    // As the diff shows them: by file, then by first line, a thread GitHub can no longer place at the file's top.
    const fileIndex = new Map(files.map((file, index) => [file.path, index]));
    const place = (entry: DrawerEntry) => fileIndex.get(entry.path) ?? files.length;
    shown.sort((a, b) => place(a) - place(b) || a.path.localeCompare(b.path) || (a.lines?.first.line ?? 0) - (b.lines?.first.line ?? 0));
  } else {
    // A thread is as recent as its latest comment; a batched comment, not yet posted, is newer than any, the last one
    // added first.
    const recency = (entry: DrawerEntry) =>
      entry.kind === 'pending' ? Number.MAX_SAFE_INTEGER - batch.length + entry.index : Math.max(...entry.thread.comments.map((comment) => Date.parse(comment.createdAt)));
    shown.sort((a, b) => recency(b) - recency(a));
  }

  const reviewers = new Map<string, UserRef>();
  for (const comment of threads.flatMap((thread) => thread.comments)) {
    const login = comment.author.login.toLowerCase();
    if (!reviewers.has(login)) reviewers.set(login, comment.author);
  }

  return {
    shown,
    hidden: threads.length + batch.length - shown.length,
    counts: {
      open: reviewersThreads.filter((thread) => !thread.isResolved).length,
      resolved: reviewersThreads.filter((thread) => thread.isResolved).length,
      pending: reviewersBatch.length,
    },
    reviewers: [...reviewers.values()].sort((a, b) => a.login.localeCompare(b.login, undefined, { sensitivity: 'base' })),
  };

  function codeAt(path: string, lines: DrawerEntry['lines']): CommentedRow[] | null {
    const patch = files.find((file) => file.path === path)?.patch;
    return lines && patch ? commentedRows(patch, lines.first, lines.last) : null;
  }
}

export interface DrawerFilters {
  /** The login of someone who started or commented in a thread; null for every reviewer. */
  reviewer: string | null;
  /** Graphite's statuses: unresolved threads (the default), resolved ones, the viewer's comments not yet submitted, or all. */
  status: 'open' | 'resolved' | 'pending' | 'all';
  /** Where they sit in the diff (the default), or the most recent first. */
  order: 'file' | 'newest';
}

/** A conversation in the drawer: a review thread, or a comment batched for the review, with the code it sits on. */
export type DrawerEntry = ({ kind: 'thread'; thread: ReviewThread } | { kind: 'pending'; draft: ReviewThreadDraft; index: number }) & {
  path: string;
  /** Its first and last commented line; null for a thread GitHub can no longer place (outdated). */
  lines: { first: DiffLineRef; last: DiffLineRef } | null;
  /** Those lines as the file's patch shows them; null when the patch does not reach them or has not arrived. */
  code: CommentedRow[] | null;
};
