// Review threads. page_data/threads has their comments but no positions; positions come from the anchors in
// base_comparison_info's `diffSummaries[].markersMap`. A thread with no anchor is outdated: its path and diff
// excerpt are read from the thread as the conversation renders it.

import type { ReviewThread } from '../model';
import type { BaseComparison } from './files';
import { githubUser, noteShape } from './session';

/** The threads, and which review opened which threads (by numeric review id). */
export function reviewThreads(data: unknown, comparison: BaseComparison, page: Document): { threads: ReviewThread[]; threadIdsByReview: Map<string, string[]> } {
  noteShape('page_data/threads', data);
  const record = (data ?? {}) as { threads?: unknown };
  const list = (Array.isArray(record.threads) ? record.threads : Array.isArray(data) ? data : Object.values(record.threads ?? {})) as RawThread[];

  const anchors = new Map<string, { path: string; side: 'LEFT' | 'RIGHT'; line: number; startLine: number | null }>();
  for (const summary of comparison.diffSummaries) {
    for (const [key, marker] of Object.entries(summary.markersMap ?? {})) {
      for (const { id, start } of marker.threads ?? []) {
        // Keys are `R<line>` / `L<line>` (right = new file, left = old file); `start` marks a multi-line range.
        anchors.set(String(id), { path: summary.path, side: key.startsWith('L') ? 'LEFT' : 'RIGHT', line: Number(key.slice(1)), startLine: start ? Number(start.slice(1)) : null });
      }
    }
  }

  const threadIdsByReview = new Map<string, string[]>();
  const threads = list.flatMap((thread): ReviewThread[] => {
    if (!thread?.id) return [];
    const id = String(thread.id);
    const reviewId = thread.pullRequestReviewId ?? thread.commentsData?.comments?.[0]?.reviewId;
    if (reviewId != null) threadIdsByReview.set(String(reviewId), [...(threadIdsByReview.get(String(reviewId)) ?? []), id]);
    const anchor = anchors.get(id);
    const rendered = threadAsRendered(page, id);
    const isOutdated = rendered?.isOutdated ?? !anchor;
    return [
      {
        id,
        path: anchor?.path ?? rendered?.path ?? '',
        line: isOutdated ? null : (anchor?.line ?? rendered?.line ?? null),
        startLine: isOutdated || anchor?.startLine === anchor?.line ? null : (anchor?.startLine ?? null),
        side: anchor?.side ?? rendered?.side ?? 'RIGHT',
        isResolved: !!thread.isResolved,
        isOutdated,
        diffHunk: rendered?.diffHunk ?? '',
        comments: (thread.commentsData?.comments ?? []).map((comment) => ({
          // The database id: replies name the comment they answer by it.
          id: String(comment.databaseId ?? comment.id),
          author: githubUser(comment.author?.login ?? 'ghost', comment.author?.avatarUrl),
          bodyHtml: comment.bodyHTML ?? '',
          body: comment.body ?? '',
          createdAt: comment.publishedAt ?? comment.createdAt ?? '',
          url: comment.url ?? `https://github.com${comment.currentDiffResourcePath ?? ''}`,
        })),
      },
    ];
  });
  return { threads, threadIdsByReview };
}

/**
 * The thread as the conversation shows it (`turbo-frame#review-thread-or-comment-id-<id>`): its file, whether it
 * is outdated, and, when expanded, its diff excerpt, whose last row is the commented line.
 */
function threadAsRendered(page: Document, id: string): { path: string; isOutdated: boolean; line: number | null; side: 'LEFT' | 'RIGHT'; diffHunk: string } | null {
  const frame = page.getElementById(`review-thread-or-comment-id-${id}`);
  if (!frame) return null;
  const rows = [...frame.querySelectorAll('table.diff-table tr')].flatMap((row) => {
    const code = row.querySelector('td.blob-code');
    if (!code || code.classList.contains('blob-code-hunk')) return [];
    const [left, right] = [...row.querySelectorAll('td.blob-num')].map((cell) => Number(cell.getAttribute('data-line-number')) || null);
    const marker = code.classList.contains('blob-code-addition') ? '+' : code.classList.contains('blob-code-deletion') ? '-' : ' ';
    return [{ marker, left: left ?? null, right: right ?? null, text: code.querySelector('.blob-code-inner')?.textContent ?? '' }];
  });
  const last = rows.at(-1);
  const oldStart = rows.find((row) => row.left)?.left ?? 0;
  const newStart = rows.find((row) => row.right)?.right ?? 0;
  const header = `@@ -${oldStart},${rows.filter((row) => row.marker !== '+').length} +${newStart},${rows.filter((row) => row.marker !== '-').length} @@`;
  return {
    path: frame.querySelector('a.text-mono')?.textContent?.trim() ?? '',
    isOutdated: [...frame.querySelectorAll('.Label')].some((label) => label.textContent?.trim() === 'Outdated'),
    line: last ? (last.marker === '-' ? last.left : last.right) : null,
    side: last?.marker === '-' ? 'LEFT' : 'RIGHT',
    diffHunk: rows.length > 0 ? [header, ...rows.map((row) => row.marker + row.text)].join('\n') : '',
  };
}

interface RawThread {
  id: string | number;
  isResolved?: boolean;
  pullRequestReviewId?: number | string | null;
  commentsData?: {
    comments?: Array<{
      id?: string;
      databaseId?: number;
      reviewId?: number | string;
      author?: { login?: string; avatarUrl?: string } | null;
      body?: string;
      bodyHTML?: string;
      createdAt?: string;
      publishedAt?: string;
      url?: string;
      currentDiffResourcePath?: string;
    }>;
  };
}
