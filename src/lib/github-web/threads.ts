// Review threads. page_data/threads (`{ threads: [thread], aliveChannel }`, its keys confirmed) has their comments but no
// positions; positions come from the anchors in base_comparison_info's `diffSummaries[].markersMap`. A thread with no
// anchor is outdated: its path and diff excerpt are read from the thread as the conversation renders it.

import { z } from 'zod';
import { REACTION_CONTENTS, type Reaction, type ReviewThread } from '../model';
import type { BaseComparison } from './files';
import { githubUser } from './session';

/** The threads, and which review opened which threads (by numeric review id). */
export function reviewThreads(answer: ThreadsAnswer, comparison: BaseComparison, page: Document): { threads: ReviewThread[]; threadIdsByReview: Map<string, string[]> } {
  const list = answer.threads ?? [];

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
          createdAt: comment.publishedAt ?? comment.createdAt ?? '',
          url: comment.url ?? `https://github.com${comment.currentDiffResourcePath ?? ''}`,
          // The node id (`PRRC_…`) is what a reaction names.
          subjectId: comment.id ?? null,
          // GitHub lists all eight reactions, given or not.
          reactions: (comment.reactionGroups ?? []).flatMap(({ reaction, reactors, totalCount }): Reaction[] => {
            const content = REACTION_CONTENTS.find((known) => known === reaction?.content);
            const count = totalCount ?? reactors?.length ?? 0;
            const viewerHasReacted = !!reaction?.viewerHasReacted;
            return content && (count > 0 || viewerHasReacted) ? [{ content, count, viewerHasReacted }] : [];
          }),
        })),
      },
    ];
  });
  return { threads, threadIdsByReview };
}

/**
 * How many of a PR's review conversations (threads) are resolved, of how many: Graphite's counter, for a PR the page
 * does not show. The threads are read as `reviewThreads` reads them.
 */
export function conversationsIn(answer: ThreadsAnswer): { resolved: number; total: number } {
  const threads = (answer.threads ?? []).filter((thread) => thread.id);
  return { resolved: threads.filter((thread) => thread.isResolved).length, total: threads.length };
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

/** page_data/threads (the fields read here); a PR without review threads may leave `threads` out. */
export const threadsAnswer = z.object({
  threads: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]),
        isResolved: z.boolean().nullish(),
        pullRequestReviewId: z.union([z.number(), z.string()]).nullish(),
        commentsData: z
          .object({
            comments: z
              .array(
                z.object({
                  id: z.string().nullish(),
                  databaseId: z.number().nullish(),
                  reviewId: z.union([z.number(), z.string()]).nullish(),
                  author: z.object({ login: z.string().nullish(), avatarUrl: z.string().nullish() }).nullish(),
                  bodyHTML: z.string().nullish(),
                  createdAt: z.string().nullish(),
                  publishedAt: z.string().nullish(),
                  url: z.string().nullish(),
                  currentDiffResourcePath: z.string().nullish(),
                  reactionGroups: z
                    .array(
                      z.object({
                        reaction: z.object({ content: z.string().nullish(), viewerHasReacted: z.boolean().nullish() }).nullish(),
                        reactors: z.array(z.unknown()).nullish(),
                        totalCount: z.number().nullish(),
                      }),
                    )
                    .nullish(),
                }),
              )
              .nullish(),
          })
          .nullish(),
      }),
    )
    .nullish(),
});

type ThreadsAnswer = z.infer<typeof threadsAnswer>;
